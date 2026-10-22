import { Elysia } from 'elysia'
import { config, validateConfig } from './lib/config'
import { loginPage } from './lib/login'
import * as authorize from './routes/authorize'
import * as token from './routes/token'
import * as userinfo from './routes/userinfo'
import * as emails from './routes/emails'
import * as discovery from './routes/discovery'
import * as jwks from './routes/jwks'
import { radiusHostManager } from './lib/radius_hosts'
import { cleanupExpiredCodes } from './lib/storage'
import path from 'node:path'
import { findProjectRoot } from './lib/server-utils'

const assetRoot = path.join(findProjectRoot(), 'public')
function rateLimiter() {
  const limits = new Map<string, { count: number; until: number }>()
  return function limited(key: string, max: number) {
    const now = Date.now()
    // Entries retain insertion order and their fixed expiry, so prune only the expired prefix.
    for (const [stale, value] of limits) {
      if (value.until > now) break
      limits.delete(stale)
    }
    const entry = limits.get(key) || { count: 0, until: now + 60000 }
    if (!limits.has(key) && limits.size >= 10000) limits.delete(limits.keys().next().value!)
    limits.set(key, entry)
    return ++entry.count > max
  }
}
async function post(request: Request, handler: (req: Request) => Promise<Response>, throttle?: (body: FormData) => Response | undefined) {
  const contentType = request.headers.get('content-type') || ''
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)(;|$)/i.test(contentType)) return Response.json({ error: 'invalid_request' }, { status: 415 })
  // Bound streamed bodies as well as requests with Content-Length.
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader) {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 16384) { await reader.cancel(); return Response.json({ error: 'invalid_request' }, { status: 413 }) }
      chunks.push(value)
    }
  }
  const bounded = new Request(request.url, { method: 'POST', headers: request.headers, body: Buffer.concat(chunks) })
  // Parse once for validation: reject duplicate values and binary fields.
  let form: FormData
  try { form = await bounded.clone().formData() } catch { return Response.json({ error: 'invalid_request' }, { status: 400 }) }
  for (const [key, value] of form) {
    if (typeof value !== 'string' || form.getAll(key).length !== 1) return Response.json({ error: 'invalid_request' }, { status: 400 })
  }
  const denied = throttle?.(form)
  return denied || handler(bounded)
}

export function createApp() {
  const limited = rateLimiter()
  const app = new Elysia({ serve: { maxRequestBodySize: 16384 } })
    .onError(({ code, error }) => {
      if (code !== 'NOT_FOUND' && code !== 'PARSE') console.error('[server] request failed', code, error instanceof Error ? error.message : 'Unknown error')
      return Response.json({ error: code === 'NOT_FOUND' ? 'not_found' : code === 'PARSE' ? 'invalid_request' : 'server_error' }, { status: code === 'NOT_FOUND' ? 404 : code === 'PARSE' ? 400 : 500 })
    })
    .mapResponse(({ responseValue, set }) => {
      const headers: Record<string, string> = {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' " + config.REDIRECT_URIS.map(value => new URL(value).origin).join(' '),
      }
      if (config.ISSUER?.startsWith('https:')) headers['Strict-Transport-Security'] = 'max-age=31536000'
      if (responseValue instanceof Response) {
        const out = new Response(responseValue.body, responseValue)
        for (const [key, value] of Object.entries(headers)) out.headers.set(key, value)
        return out
      }
      Object.assign(set.headers, headers)
    })
    .get('/', () => Response.redirect(new URL('/radius_login', config.ISSUER || `http://localhost:${config.HTTP_PORT}`), 302))
    .get('/radius_login', ({ request }) => loginPage(request))
    .get('/radius_login/', ({ request }) => loginPage(request))
  for (const name of ['login.css', 'login.js', 'grafana-logo.svg', 'favicon.ico']) {
    app.get(`/radius_login/${name}`, () => new Response(Bun.file(path.join(assetRoot, name))))
  }
  for (const prefix of ['/radius_login/api', '/api']) {
    app.get(`${prefix}/oauth/authorize`, ({ request }) => authorize.GET(request))
      .post(`${prefix}/oauth/authorize`, ({ request }) => post(request, authorize.POST, body => {
        // The peer comes from the socket, and each account has its own bucket.
        // Grafana token exchanges never consume browser login capacity.
        const peer = app.server?.requestIP(request)?.address || 'local'
        const user = String(body.get('user') || '').split('@')[0].toLowerCase()
        if (limited(`${peer}:${user}`, 20)) return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } })
      }), { parse: 'none' })
      .post(`${prefix}/oauth/token`, ({ request }) => post(request, token.POST), { parse: 'none' })
      .get(`${prefix}/oauth/userinfo`, ({ request }) => userinfo.GET(request))
      .get(`${prefix}/oauth/userinfo/emails`, ({ request }) => emails.GET(request))
    for (const [route, handlers] of [['openid-configuration', discovery], ['jwks.json', jwks]] as const) {
      app.get(`${prefix}/.well-known/${route}`, ({ request }) => handlers.GET(request))
        .options(`${prefix}/.well-known/${route}`, ({ request }) => handlers.OPTIONS(request))
    }
  }
  app.get('/.well-known/openid-configuration', ({ request }) => discovery.GET(request))
    .get('/.well-known/jwks.json', () => jwks.GET())
  return app
}

if (import.meta.main) {
  validateConfig()
  const app = createApp().listen({ hostname: config.HTTP_HOST, port: config.HTTP_PORT })
  radiusHostManager.start()
  const cleanup = setInterval(() => { void cleanupExpiredCodes() }, 60000)
  const stop = async () => { clearInterval(cleanup); radiusHostManager.stop(); await app.stop(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  console.info(`Listening on ${app.server?.hostname}:${app.server?.port}`)
}
