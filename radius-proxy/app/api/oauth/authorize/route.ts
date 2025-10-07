import { NextResponse } from "next/server"
import { radiusAuthenticate } from "@/lib/radius"
import { config } from "@/lib/config"
import { isClassPermitted } from "@/lib/access"
import crypto from "crypto"
import { warn, error, info } from "@/lib/log"

// Very small authorize implementation: accepts POST with username/password and client_id, responds with code

declare global {
  // pointer for simple in-memory code store for demo only
  // Each entry may include an optional expiresAt timestamp (ms since epoch).
  var _oauth_codes: Record<string, { username: string; class?: string; scope?: string; groups?: string[]; expiresAt?: number }>
}

// GET /api/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&state=...
// Grafana will hit this. We redirect user to /login (UI) preserving params so the form can POST back.
export async function GET(req: Request) {
  const url = new URL(req.url)
  // Honor reverse proxy headers for proper external URL construction
  const xfProto = req.headers.get('x-forwarded-proto')
  const xfHost = req.headers.get('x-forwarded-host')
  if (xfHost) {
    url.host = xfHost
  }
  if (xfProto) {
    url.protocol = xfProto + ':'
  }
  const client_id = url.searchParams.get('client_id') || ''
  const redirect_uri = url.searchParams.get('redirect_uri') || ''
  const state = url.searchParams.get('state') || ''
  const response_type = url.searchParams.get('response_type') || 'code'

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
  const start = Date.now()
  // derive origin for absolute redirects (respecting reverse proxy headers like in GET)
  let origin: string
  try {
    const u = new URL(req.url)
    const xfProto = req.headers.get('x-forwarded-proto')
    const xfHost = req.headers.get('x-forwarded-host')
    if (xfHost) u.host = xfHost
    if (xfProto) u.protocol = xfProto + ':'
    origin = u.origin
  } catch {
    origin = 'http://localhost:3000'
  }

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
    res = await radiusAuthenticate(RADIUS_HOST, RADIUS_SECRET, username, password)
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
  
  // For this demo, we'll store the mapping in a very naive global (suitable for single-process dev only)
  global._oauth_codes = global._oauth_codes || {}
  // Remove any expired codes to avoid unbounded memory growth in long-running processes.
  try {
    for (const k of Object.keys(global._oauth_codes)) {
      const e = global._oauth_codes[k]
      if (e && typeof e.expiresAt === 'number' && Date.now() > e.expiresAt) {
        delete global._oauth_codes[k]
      }
    }
  } catch (e) {
    // Defensive: don't let cleanup failures affect normal flow
    warn('[authorize] oauth code cleanup failed', e)
  }
  // Derive groups from RADIUS Class attribute.
  // Strategy: if class contains semicolons or commas, split; otherwise single value.
  function deriveGroups(classAttr?: string): string[] {
    if (!classAttr) return []
    // Only pass through the raw RADIUS class tokens (split on ; or ,)
    return classAttr.split(/[;,]/).map(p=>p.trim()).filter(Boolean)
  }
  const groups = deriveGroups(res.class)
  global._oauth_codes[code] = { username, class: res.class, scope, groups, expiresAt }

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
      info('[authorize] success', { user: username, class: res.class, ms: Date.now() - start })
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
  let baseOrigin = origin || 'http://localhost:3000'
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
