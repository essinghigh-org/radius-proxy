import crypto from 'node:crypto'
import { signToken } from '../lib/jwt'
import { config } from '../lib/config'
import { getIssuer } from '../lib/server-utils'
import { getStorage, type OAuthCodeEntry } from '../lib/storage'
import { addUserToTeamByEmail } from '../lib/grafana'
import { isClassPermitted } from '../lib/access'

function equal(a: string, b: string) {
  const hash = (value: string) => crypto.createHash('sha256').update(value).digest()
  return crypto.timingSafeEqual(hash(a), hash(b))
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
}
export async function POST(req: Request) {
  const body = await req.formData()
  let clientId = String(body.get('client_id') || '')
  let secret = String(body.get('client_secret') || '')
  const auth = req.headers.get('authorization')
  if (auth) {
    if (!auth.startsWith('Basic ') || body.has('client_secret')) return json({ error: 'invalid_client' }, 401)
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
      const separator = decoded.indexOf(':')
      if (separator < 0) throw new Error('Invalid Basic credentials')
      clientId = decodeURIComponent(decoded.slice(0, separator).replace(/\+/g, ' '))
      secret = decodeURIComponent(decoded.slice(separator + 1).replace(/\+/g, ' '))
    } catch { return json({ error: 'invalid_client' }, 401) }
  }
  if (clientId !== config.OAUTH_CLIENT_ID || !equal(secret, config.OAUTH_CLIENT_SECRET)) return json({ error: 'invalid_client' }, 401)
  const storage = getStorage()
  const grant = body.get('grant_type')
  let entry: OAuthCodeEntry | undefined
  if (grant === 'authorization_code') {
    entry = await storage.consume(String(body.get('code') || ''))
    if (!entry || entry.clientId !== clientId || entry.redirectUri !== body.get('redirect_uri')) return json({ error: 'invalid_grant' }, 400)
    const verifier = String(body.get('code_verifier') || '')
    if (entry.code_challenge && (entry.code_challenge_method !== 'S256' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !equal(crypto.createHash('sha256').update(verifier).digest('base64url'), entry.code_challenge))) return json({ error: 'invalid_grant' }, 400)
    if (!entry.code_challenge && verifier) return json({ error: 'invalid_grant' }, 400)
  } else if (grant === 'refresh_token') {
    entry = await storage.consumeRefreshToken(String(body.get('refresh_token') || ''))
    if (!entry || entry.clientId !== clientId) return json({ error: 'invalid_grant' }, 400)
  } else return json({ error: 'unsupported_grant_type' }, 400)
  if (!isClassPermitted(entry.class)) return json({ error: 'invalid_grant' }, 400)
  const groups = entry.groups || []
  const admin = groups.some(group => config.ADMIN_CLASSES.includes(group))
  const email = `${entry.username}@${config.EMAIL_SUFFIX}`
  const claims = { sub: entry.username, name: entry.username, email, groups, grafana_admin: admin, role: admin ? 'GrafanaAdmin' : undefined, iss: getIssuer(req), aud: clientId }
  const scope = entry.scope || 'openid profile'
  const accessToken = signToken({ ...claims, scope, token_use: 'access' }, { expiresIn: '1h' })
  const idToken = signToken({ ...claims, nonce: grant === 'authorization_code' ? entry.nonce : undefined, token_use: 'id' }, { expiresIn: '1h' })
  const refreshToken = crypto.randomBytes(32).toString('base64url')
  await storage.setRefreshToken(refreshToken, { ...entry, nonce: undefined, expiresAt: grant === 'refresh_token' ? entry.expiresAt : Date.now() + config.OAUTH_REFRESH_TOKEN_TTL * 1000 })
  if (grant === 'authorization_code' && config.GRAFANA_SA_TOKEN) {
    for (const team of new Set(groups.flatMap(group => Object.hasOwn(config.CLASS_MAP, group) ? config.CLASS_MAP[group] : []))) {
      void addUserToTeamByEmail(team, email, entry.username, claims.role).catch(() => {})
    }
  }
  return json({ access_token: accessToken, token_type: 'bearer', expires_in: 3600, id_token: idToken, refresh_token: refreshToken, scope })
}
