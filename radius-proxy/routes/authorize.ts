import crypto from 'node:crypto'
import { config } from '../lib/config'
import { getIssuer } from '../lib/server-utils'
import { radiusAuthenticate } from '../lib/radius'
import { getActiveRadiusHost } from '../lib/radius_hosts'
import { isClassPermitted } from '../lib/access'
import { normalizeRequestedScopes } from '../lib/scopes'
import { getStorage } from '../lib/storage'

export function validRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash && config.REDIRECT_URIS.includes(value)
  } catch { return false }
}

function validate(params: URLSearchParams | FormData): string | undefined {
  if (params.get('client_id') !== config.OAUTH_CLIENT_ID) return 'invalid_client'
  if (!validRedirect(String(params.get('redirect_uri') || ''))) return 'invalid_request'
  if (params.get('response_type') && params.get('response_type') !== 'code') return 'unsupported_response_type'
  const challenge = String(params.get('code_challenge') || '')
  const method = String(params.get('code_challenge_method') || '')
  if ((challenge && (method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge))) || (!challenge && method)) return 'invalid_request'
  try { normalizeRequestedScopes(String(params.get('scope') || '')) } catch { return 'invalid_scope' }
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const error = validate(params)
  if (error) return Response.json({ error }, { status: 400 })
  const login = new URL('/radius_login', getIssuer(req))
  for (const key of ['client_id', 'redirect_uri', 'state', 'scope', 'nonce', 'code_challenge', 'code_challenge_method']) {
    if (params.has(key)) login.searchParams.set(key, params.get(key)!)
  }
  return Response.redirect(login, 302)
}

let activeAuthentications = 0

export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  if (origin && origin !== new URL(getIssuer(req)).origin) return Response.json({ error: 'invalid_request' }, { status: 403 })
  const body = await req.formData()
  const error = validate(body)
  if (error) return Response.json({ error }, { status: 400 })
  const fail = (error: string, status: number) => {
    if (body.get('accept') === 'json') return Response.json({ error }, { status })
    const login = new URL('/radius_login', getIssuer(req))
    for (const key of ['client_id', 'redirect_uri', 'state', 'scope', 'nonce', 'code_challenge', 'code_challenge_method']) {
      if (body.has(key)) login.searchParams.set(key, String(body.get(key)))
    }
    login.searchParams.set('error', error)
    return Response.redirect(login, 302)
  }
  const rawUsername = String(body.get('user') || '')
  const username = rawUsername.split('@')[0]
  const password = String(body.get('password') || '')
  if (!username || !password || Buffer.byteLength(username) > 253 || Buffer.byteLength(password) > 128) return fail('invalid_request', 400)
  // The email domain is operator-controlled: a user cannot impersonate another Grafana email.
  const emailDomain = config.EMAIL_SUFFIX
  let result
  if (activeAuthentications >= 64) return fail("temporarily_unavailable", 503)
  activeAuthentications++
  try { result = await radiusAuthenticate(getActiveRadiusHost(), username, password, config.RADIUS_TIMEOUT * 1000) }
  catch { return fail('server_error', 503) }
  finally { activeAuthentications-- }
  if (!result.ok || !isClassPermitted(result.class)) return fail('access_denied', 401)
  const code = crypto.randomBytes(32).toString('base64url')
  await getStorage().set(code, {
    username, emailDomain, class: result.class,
    groups: result.class?.split(/[;,]/).map(value => value.trim()).filter(Boolean) || [],
    scope: normalizeRequestedScopes(String(body.get('scope') || '')),
    clientId: config.OAUTH_CLIENT_ID,
    redirectUri: String(body.get('redirect_uri')),
    nonce: String(body.get('nonce') || '') || undefined,
    code_challenge: String(body.get('code_challenge') || '') || undefined,
    code_challenge_method: String(body.get('code_challenge_method') || '') || undefined,
    expiresAt: Date.now() + config.OAUTH_CODE_TTL * 1000,
  })
  const target = new URL(String(body.get('redirect_uri')))
  target.searchParams.set('code', code)
  if (body.get('state')) target.searchParams.set('state', String(body.get('state')))
  if (body.get('accept') === 'json') return Response.json({ redirect: target.toString() })
  return Response.redirect(target, 302)
}
