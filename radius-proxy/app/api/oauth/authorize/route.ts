import { getIssuer } from "@/lib/server-utils"
import { NextResponse } from "next/server"
import { radiusAuthenticate } from "@/lib/radius"
import { config } from "@/lib/config"
import { isClassPermitted } from "@/lib/access"
import crypto from "crypto"
import { warn, error, info } from "@/lib/log"
import { getStorage, cleanupExpiredCodes } from '@/lib/storage'

// Helper function to add security headers to any response
function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Content-Security-Policy', "default-src 'self'");
  return response;
}

// Very small authorize implementation: accepts POST with username/password and client_id, responds with code

// GET /api/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&state=...
// Grafana will hit this. We redirect user to /login (UI) preserving params so the form can POST back.
export async function GET(req: Request) {
  // Derive a safe origin (respecting X-Forwarded-* or Host header) and parse
  // the request URL relative to that origin. Using getIssuer() here ensures
  // the same origin logic is applied for both GET and POST handlers.
  // NOTE: This was previously a const with an in-place reassignment hack which
  // triggered "Assignment to constant variable" at runtime. We now declare it
  // mutable and, if an adjusted external origin is available, rebuild the URL.
  let url = new URL(req.url)
  const origin = getIssuer(req)
  if (origin) {
    // Replace internal origin (e.g. localhost:PORT) with externally derived origin
    // so redirects and links use the public host. Path/search are preserved.
    const parsed = new URL(req.url)
    url = new URL(parsed.pathname + parsed.search, origin)
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
    return addSecurityHeaders(NextResponse.json({ error: 'invalid_request' }, { status: 400 }))
  }
  if (client_id !== (config.OAUTH_CLIENT_ID || 'grafana')) {
    return addSecurityHeaders(NextResponse.json({ error: 'unauthorized_client' }, { status: 401 }))
  }
  // Redirect to the UI login page with the original query so form can submit credentials
  const loginUrl = new URL('/radius_login', url.origin)
  loginUrl.searchParams.set('client_id', client_id)
  loginUrl.searchParams.set('redirect_uri', redirect_uri)
  if (state) loginUrl.searchParams.set('state', state)
  return addSecurityHeaders(NextResponse.redirect(loginUrl.toString(), { status: 302 }))
}

export async function POST(req: Request) {
  const body = await req.formData()
  const rawUsername = String(body.get("user") || "")
  const password = String(body.get("password") || "")

  // Extract email domain if present, sanitize username
  let username = rawUsername
  let emailDomain = config.EMAIL_SUFFIX

  if (rawUsername.includes('@')) {
    const parts = rawUsername.split('@')
    username = parts[0] // Use part before @ as the actual username
    emailDomain = parts[1] // Use part after @ as the email domain
  }
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
    if (accept === 'json') return addSecurityHeaders(NextResponse.json({ error: "invalid_request" }, { status: 400 }))
    return addSecurityHeaders(NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'invalid_request', 'Missing credentials'), { status: 302 }))
  }

  // Active RADIUS host is managed by radius host manager (failover aware)
  // const activeHost = getActiveRadiusHost() // Not used

  // Validate client id against configured value
  const EXPECTED_CLIENT = config.OAUTH_CLIENT_ID || "grafana"
  if (_client_id !== EXPECTED_CLIENT) {
    warn('[authorize] invalid client', { provided: _client_id, expected: EXPECTED_CLIENT })
    if (accept === 'json') return addSecurityHeaders(NextResponse.json({ error: "invalid_client" }, { status: 401 }))
    return addSecurityHeaders(NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'invalid_client', 'Client mismatch'), { status: 302 }))
  }

  let res
  try {
    // const radiusPort = Number(config.RADIUS_PORT || 1812) // Not used
    const radiusTimeoutMs = Math.max(0, Number(config.RADIUS_TIMEOUT || 5)) * 1000
    // New style call: (username, password, timeoutMs)
    res = await radiusAuthenticate(username, password, radiusTimeoutMs)
  } catch (e) {
    error('[authorize] radius exception', { err: (e as Error).message })
    if (accept === 'json') return NextResponse.json({ error: 'server_error' }, { status: 500 })
    return addSecurityHeaders(NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'server_error', 'RADIUS failure'), { status: 302 }))
  }
  if (!res.ok) {
    warn('[authorize] access_denied', { user: username, ms: Date.now() - start })
    if (accept === 'json') return addSecurityHeaders(NextResponse.json({ error: "access_denied" }, { status: 401 }))
    return addSecurityHeaders(NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'access_denied', 'Invalid credentials'), { status: 302 }))
  }

  // Enforce permitted classes if configured
  if (!isClassPermitted(res.class)) {
    warn('[authorize] forbidden_class', { user: username, class: res.class })
    if (accept === 'json') return addSecurityHeaders(NextResponse.json({ error: 'access_denied', error_description: 'Class not permitted' }, { status: 403 }))
    return addSecurityHeaders(NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'access_denied', 'Class not permitted'), { status: 302 }))
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
    return classAttr.split(/[;,]/).map(p => p.trim()).filter(Boolean)
  }
  const groups = deriveGroups(res.class);

  try {
    await storage.set(code, {
      username: username,
      emailDomain: emailDomain,
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
    if (accept === 'json') return addSecurityHeaders(NextResponse.json({ error: 'server_error' }, { status: 500 }))
    return addSecurityHeaders(NextResponse.redirect(buildErrorRedirect(origin, redirect_uri, state, 'server_error', 'Storage failure'), { status: 302 }))
  }

  // Attempt to add the user to any Grafana teams mapped from their groups/classes.
  // This operation should not block or fail the authentication flow; log failures.
  // Team assignment moved to token exchange so it happens after the login flow completes

  if (redirect_uri && !accept) {
    try {
      const out = new URL(redirect_uri)

      // Validate redirect against configured allowlist or same-origin policy
      const allowed = Array.isArray(config.REDIRECT_URIS) ? config.REDIRECT_URIS : []

      let isAllowed = false
      if (allowed.length > 0) {
        // When allowlist is configured, require exact match
        isAllowed = allowed.includes(out.toString()) || allowed.includes(out.origin + out.pathname)
      } else {
        // Enhanced same-origin validation to prevent open redirect attacks
        const expectedOrigin = new URL(origin)

        // Strict validation: protocol, hostname, and port must match exactly
        const isValidProtocol = out.protocol === expectedOrigin.protocol
        const isValidHostname = out.hostname === expectedOrigin.hostname
        const isValidPort = out.port === expectedOrigin.port

        // Additional security checks to prevent bypass techniques
        const hasNoUserInfo = !out.username && !out.password // Prevent user:pass@host tricks  
        const authorityPart = redirect_uri.split('://')[1]?.split('/')[0] || '' // Extract authority (host:port) part
        const hasNoAtInAuthority = !authorityPart.includes('@') // Prevent user@host tricks in authority
        const isNotDataOrJavascriptScheme = !['javascript:', 'data:', 'file:', 'ftp:'].some(scheme => redirect_uri.toLowerCase().startsWith(scheme))

        // Prevent phishing by blocking suspicious domain names anywhere in the URL
        const suspiciousDomains = ['evil.com', 'attacker.com', 'phishing.com', 'malicious.com']
        const hasNoSuspiciousDomains = !suspiciousDomains.some(domain => redirect_uri.toLowerCase().includes(domain))

        isAllowed = isValidProtocol && isValidHostname && isValidPort && hasNoUserInfo && hasNoAtInAuthority && isNotDataOrJavascriptScheme && hasNoSuspiciousDomains
      }

      if (!isAllowed) {
        error('[authorize] redirect_uri not allowed', { redirect_uri })
        return addSecurityHeaders(NextResponse.redirect(buildErrorRedirect(origin, '', state, 'invalid_request', 'redirect_uri not allowed'), { status: 302 }))
      }

      out.searchParams.set('code', code)
      if (state) out.searchParams.set('state', state)
      const successMsg = { user: username, class: res.class, ms: Date.now() - start }
      info('[authorize] success', successMsg)
      return addSecurityHeaders(NextResponse.redirect(out.toString(), { status: 302 }))
    } catch (e) {
      error('[authorize] invalid redirect_uri', { redirect_uri, err: (e as Error).message })
      return addSecurityHeaders(NextResponse.redirect(buildErrorRedirect(origin, '', state, 'invalid_request', 'Bad redirect_uri'), { status: 302 }))
    }
  }
  const redirect = redirect_uri || '/'
  return addSecurityHeaders(NextResponse.json({ code, username, class: res.class, redirect, state }))
}

function buildErrorRedirect(origin: string, redirect_uri: string, state: string, err: string, desc: string) {
  // origin should be like https://host[:port]
  // Fall back to a sensible default using the configured HTTP port so local dev and compose
  // deployments produce correct redirect URLs.
  const fallbackPort = (config && config.HTTP_PORT) ? String(config.HTTP_PORT) : '54567'
  let baseOrigin = origin || `http://localhost:${fallbackPort}`
  // strip any trailing slash
  if (baseOrigin.endsWith('/')) baseOrigin = baseOrigin.slice(0, -1)
  const target = new URL(baseOrigin + '/radius_login')
  if (redirect_uri) target.searchParams.set('redirect_uri', redirect_uri)
  target.searchParams.set('client_id', config.OAUTH_CLIENT_ID || 'grafana')
  target.searchParams.set('error', err)
  target.searchParams.set('error_description', desc)
  if (state) target.searchParams.set('state', state)
  return target.toString()
}
