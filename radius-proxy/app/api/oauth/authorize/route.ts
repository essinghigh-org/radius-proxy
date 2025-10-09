import { getIssuer } from "@/lib/server-utils"
import { NextResponse } from "next/server"
import { radiusAuthenticate } from "@/lib/radius"
import { config } from "@/lib/config"
import { isClassPermitted } from "@/lib/access"
import crypto from "crypto"
import { warn, error, info } from "@/lib/log"
import { getStorage, cleanupExpiredCodes } from '@/lib/storage'

// Very small authorize implementation: accepts POST with username/password and client_id, responds with code

// GET /api/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&state=...
// Grafana will hit this. We redirect user to /login (UI) preserving params so the form can POST back.
export async function GET(req: Request) {
  // Derive a safe origin (respecting X-Forwarded-* or Host header) and parse
  // the request URL relative to that origin. Using getIssuer() here ensures
  // the same origin logic is applied for both GET and POST handlers.
  const url = new URL(req.url)
  const origin = getIssuer(req)
  // If getIssuer returned a valid origin, prefer it for URL origin so we do
  // not leak internal server ports when the external request didn't include one.
  if (origin) {
    // Create a fresh URL for the incoming request but replace origin with
    // the computed origin so subsequent URL.origin uses the external host.
    const parsed = new URL(req.url)
    const adjusted = new URL(parsed.pathname + parsed.search, origin)
    // overwrite url variable used below
    // eslint-disable-next-line prefer-const
    ;(url as unknown as URL) = adjusted
  }
  const client_id = url.searchParams.get('client_id') || ''
  const redirect_uri = url.searchParams.get('redirect_uri') || ''
  const code_challenge = url.searchParams.get('code_challenge') || ''
  const code_challenge_method = url.searchParams.get('code_challenge_method') || ''
  const state = url.searchParams.get('state') || ''
  const response_type = url.searchParams.get('response_type') || 'code'

  // Always log GET params so dev server consoles show incoming requests (helps debug PKCE presence)
  info('[authorize GET] params', { client_id, redirect_uri, state, response_type, code_challenge, code_challenge_method })

  // Basic validation
  if (!client_id || !redirect_uri || response_type !== 'code') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (client_id !== (config.OAUTH_CLIENT_ID || 'grafana')) {
    return NextResponse.json({ error: 'unauthorized_client' }, { status: 401 })
  }
  // Redirect to the UI login page with the original query so form can submit credentials
  const loginUrl = new URL('/login', url.origin)
  loginUrl.searchParams.set('client_id', client_id)
  loginUrl.searchParams.set('redirect_uri', redirect_uri)
  if (state) loginUrl.searchParams.set('state', state)
  return NextResponse.redirect(loginUrl.toString(), { status: 302 })
}

export async function POST(req: Request) {
  const body = await req.formData()
  const username = String(body.get("user") || "")
  const password = String(body.get("password") || "")
  const _client_id = String(body.get("client_id") || "grafana")
  const redirect_uri = String(body.get('redirect_uri') || '')
  const state = String(body.get('state') || '')
  const accept = String(body.get('accept') || '') // if set to json, return JSON instead of redirect
  const scope = String(body.get('scope') || 'openid profile')
  // PKCE parameters (optional)
  const code_challenge = String(body.get('code_challenge') || '')
  const code_challenge_method = String(body.get('code_challenge_method') || '')
  // Log incoming PKCE on POST as well so dev server shows it immediately
  info('[authorize POST] received', { client_id: _client_id, redirect_uri, state, code_challenge: !!code_challenge, code_challenge_method })
  const start = Date.now()
  // derive origin for absolute redirects (respecting reverse proxy headers like in GET)
  const origin = getIssuer(req)

  if (!username || !password) {
    warn('[authorize] missing credentials', { client: _client_id })
    if (accept === 'json') return NextResponse.json({ error: "invalid_request" }, { status: 400 })
    return NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'invalid_request', 'Missing credentials'), { status: 302 })
  }

  // Read RADIUS config
  const RADIUS_HOST = config.RADIUS_HOST
  const RADIUS_SECRET = config.RADIUS_SECRET

  // Validate client id against configured value
  const EXPECTED_CLIENT = config.OAUTH_CLIENT_ID || "grafana"
  if (_client_id !== EXPECTED_CLIENT) {
    warn('[authorize] invalid client', { provided: _client_id, expected: EXPECTED_CLIENT })
    if (accept === 'json') return NextResponse.json({ error: "invalid_client" }, { status: 401 })
    return NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'invalid_client', 'Client mismatch'), { status: 302 })
  }

  let res
  try {
  const radiusPort = Number(config.RADIUS_PORT || 1812)
  // Convert configured timeout (seconds) to milliseconds for radius client
  const radiusTimeoutMs = Math.max(0, Number(config.RADIUS_TIMEOUT || 5)) * 1000
  res = await radiusAuthenticate(RADIUS_HOST, RADIUS_SECRET, username, password, radiusTimeoutMs, radiusPort)
  } catch (e) {
    error('[authorize] radius exception', { err: (e as Error).message })
    if (accept === 'json') return NextResponse.json({ error: 'server_error' }, { status: 500 })
    return NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'server_error', 'RADIUS failure'), { status: 302 })
  }
  if (!res.ok) {
    warn('[authorize] access_denied', { user: username, ms: Date.now() - start })
    if (accept === 'json') return NextResponse.json({ error: "access_denied" }, { status: 401 })
    return NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'access_denied', 'Invalid credentials'), { status: 302 })
  }

  // Enforce permitted classes if configured
  if (!isClassPermitted(res.class)) {
    warn('[authorize] forbidden_class', { user: username, class: res.class })
    if (accept === 'json') return NextResponse.json({ error: 'access_denied', error_description: 'Class not permitted' }, { status: 403 })
    return NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'access_denied', 'Class not permitted'), { status: 302 })
  }

  // Generate a cryptographically unguessable one-time code and expiry.
  const code = crypto.randomBytes(24).toString("base64url")
  const expiresAt = Date.now() + (Number(config.OAUTH_CODE_TTL || 300) * 1000)
  
  // Use the storage abstraction layer
  const storage = getStorage()
  
  // Clean up expired codes periodically (non-blocking)
  cleanupExpiredCodes().catch(err => {
    warn('[authorize] Failed to cleanup expired codes', { error: err.message })
  })

  // Derive groups from RADIUS Class attribute.
  // Strategy: if class contains semicolons or commas, split; otherwise single value.
  function deriveGroups(classAttr?: string): string[] {
    if (!classAttr) return []
    // Only pass through the raw RADIUS class tokens (split on ; or ,)
    return classAttr.split(/[;,]/).map(p=>p.trim()).filter(Boolean)
  }
  const groups = deriveGroups(res.class);
  
  try {
    await storage.set(code, { 
      username: username, 
      class: res.class, 
      scope: scope, 
      groups: groups, 
      // store PKCE challenge if provided (per RFC7636)
      code_challenge: code_challenge || undefined,
      code_challenge_method: code_challenge_method || undefined,
      expiresAt: expiresAt 
    })
    if (code_challenge) {
      const msg = { user: username, code: code, method: code_challenge_method || 'plain' }
      info('[authorize] stored PKCE challenge', msg)
    }
  } catch (err) {
    error('[authorize] Failed to store OAuth code', { error: (err as Error).message })
    if (accept === 'json') return NextResponse.json({ error: 'server_error' }, { status: 500 })
    return NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'server_error', 'Storage failure'), { status: 302 })
  }

  // Attempt to add the user to any Grafana teams mapped from their groups/classes.
  // This operation should not block or fail the authentication flow; log failures.
  // Team assignment moved to token exchange so it happens after the login flow completes

  if (redirect_uri && !accept) {
    try {
      const out = new URL(redirect_uri)
      // Validate redirect against configured allowlist or same-origin policy
      const allowed = Array.isArray(config.REDIRECT_URIS) ? config.REDIRECT_URIS : []
      const isAllowed = allowed.length
        ? allowed.includes(out.toString()) || allowed.includes(out.origin + out.pathname)
        : out.origin === origin
      if (!isAllowed) {
        error('[authorize] redirect_uri not allowed', { redirect_uri })
        return NextResponse.redirect(buildErrorRedirect(origin, '', state, 'invalid_request', 'redirect_uri not allowed'), { status: 302 })
      }
      out.searchParams.set('code', code)
      if (state) out.searchParams.set('state', state)
  const successMsg = { user: username, class: res.class, ms: Date.now() - start }
  info('[authorize] success', successMsg)
      return NextResponse.redirect(out.toString(), { status: 302 })
    } catch (e) {
      error('[authorize] invalid redirect_uri', { redirect_uri, err: (e as Error).message })
      return NextResponse.redirect(buildErrorRedirect(origin, '', state, 'invalid_request', 'Bad redirect_uri'), { status: 302 })
    }
  }
  const redirect = redirect_uri || '/'
  return NextResponse.json({ code, username, class: res.class, redirect, state })
}

function buildErrorRedirect(origin: string, redirect_uri: string, state: string, err: string, desc: string) {
  // origin should be like https://host[:port]
  // Fall back to a sensible default using the configured HTTP port so local dev and compose
  // deployments produce correct redirect URLs.
  const fallbackPort = (config && config.HTTP_PORT) ? String(config.HTTP_PORT) : '54567'
  let baseOrigin = origin || `http://localhost:${fallbackPort}`
  // strip any trailing slash
  if (baseOrigin.endsWith('/')) baseOrigin = baseOrigin.slice(0, -1)
  const target = new URL(baseOrigin + '/login')
  if (redirect_uri) target.searchParams.set('redirect_uri', redirect_uri)
  target.searchParams.set('client_id', config.OAUTH_CLIENT_ID || 'grafana')
  target.searchParams.set('error', err)
  target.searchParams.set('error_description', desc)
  if (state) target.searchParams.set('state', state)
  return target.toString()
}
