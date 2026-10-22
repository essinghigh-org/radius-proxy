import { beforeEach, expect, mock, test } from 'bun:test'
import crypto from 'node:crypto'
import { closeStorage } from '../lib/storage'
import { config, _invalidateConfigCache, validateConfig } from '../lib/config'
import { getIssuer } from '../lib/server-utils'
import { signToken } from '../lib/jwt'
import { createApp } from '../server'

let calls = 0
let authGate: Promise<void> | undefined
mock.module('../lib/radius', () => ({ radiusAuthenticate: async () => { calls++; await authGate; return { ok: true, class: 'admin_group' } } }))
const callback = 'https://grafana.example.com/login/generic_oauth'
const origin = 'https://auth.example.com'
let app = createApp()
beforeEach(async () => { await closeStorage(); _invalidateConfigCache(); calls = 0; authGate = undefined; app = createApp() })
function post(route: string, fields: Record<string, string>, headers: HeadersInit = {}) {
  return app.handle(new Request(`${origin}/radius_login/api/oauth/${route}`, { method: 'POST', body: new URLSearchParams(fields), headers }))
}
async function authorize(extra: Record<string, string> = {}) {
  return post('authorize', { user: 'testuser', password: 'testpass', client_id: 'grafana', redirect_uri: callback, ...extra })
}
async function issueCode(extra: Record<string, string> = {}) {
  const response = await authorize(extra)
  expect(response.status).toBe(302)
  return new URL(response.headers.get('location')!).searchParams.get('code')!
}
function exchange(code: string, extra: Record<string, string> = {}) {
  return post('token', { grant_type: 'authorization_code', code, client_id: 'grafana', client_secret: 'secret', redirect_uri: callback, ...extra })
}

test('Elysia serves the login page and assets with security headers', async () => {
  for (const path of ['/radius_login', '/radius_login/', '/radius_login/login.css', '/radius_login/login.js', '/radius_login/grafana-logo.svg']) {
    const response = await app.handle(new Request(origin + path))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('same-origin')
    expect((await response.text()).length).toBeGreaterThan(10)
  }
})
test('discovery and signing issuer ignore forged Host and forwarding headers', async () => {
  const request = new Request(origin + '/.well-known/openid-configuration', { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' } })
  expect(getIssuer(request)).toBe(origin)
  const data = await (await app.handle(request)).json()
  expect(data.issuer).toBe(origin)
  expect(data).not.toHaveProperty('op_config')
  expect(data.authorization_endpoint).toBe(origin + '/radius_login/api/oauth/authorize')
  expect(data.code_challenge_methods_supported).toEqual(['S256'])
})
test('authorize rejects unregistered and query-mutated redirects before contacting RADIUS', async () => {
  for (const redirect_uri of ['https://evil.example', callback + '?next=https://evil.example', callback + '#fragment', 'javascript:alert(1)']) {
    expect((await authorize({ redirect_uri })).status).toBe(400)
    expect((await authorize({ redirect_uri, accept: 'json' })).status).toBe(400)
  }
  expect(calls).toBe(0)
})
test('browser authorization rejects cross-origin credential submission', async () => {
  const response = await post('authorize', { user: 'testuser', password: 'testpass', client_id: 'grafana', redirect_uri: callback }, { Origin: 'https://evil.example' })
  expect(response.status).toBe(403)
  expect(calls).toBe(0)
})
test('PKCE, scope, state and nonce survive browser redirect and form rendering', async () => {
  const verifier = 'a'.repeat(43)
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const params = new URLSearchParams({ client_id: 'grafana', redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'openid email', state: 'a-state', nonce: 'a-nonce' })
  const response = await app.handle(new Request(origin + '/radius_login/api/oauth/authorize?' + params))
  const login = new URL(response.headers.get('location')!)
  for (const key of ['code_challenge', 'code_challenge_method', 'scope', 'state', 'nonce']) expect(login.searchParams.get(key)).toBe(params.get(key))
  const html = await (await app.handle(new Request(login))).text()
  expect(html).toContain('name="nonce" value="a-nonce"')
  expect(html).toContain(`name="code_challenge" value="${challenge}"`)
  const code = await issueCode({ code_challenge: challenge, code_challenge_method: 'S256', nonce: 'a-nonce' })
  const tokens = await (await exchange(code, { code_verifier: verifier })).json()
  const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
  expect(claims.nonce).toBe('a-nonce')
})
test('login HTML escapes OAuth query attributes', async () => {
  const html = await (await app.handle(new Request(origin + '/radius_login?state=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E'))).text()
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain('&quot;&gt;&lt;script&gt;')
})
test('authorization codes require the original redirect URI and are consumed on failure', async () => {
  const code = await issueCode()
  expect((await exchange(code, { redirect_uri: 'https://evil.example' })).status).toBe(400)
  expect((await exchange(code)).status).toBe(400)
  const missing = await issueCode()
  expect((await post('token', { grant_type: 'authorization_code', code: missing, client_id: 'grafana', client_secret: 'secret' })).status).toBe(400)
})
test('concurrent code redemption and refresh rotation have exactly one winner', async () => {
  const code = await issueCode()
  const responses = await Promise.all([exchange(code), exchange(code)])
  expect(responses.map(response => response.status).sort()).toEqual([200, 400])
  const tokens = await responses.find(response => response.ok)!.json()
  const fields = { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: 'grafana', client_secret: 'secret' }
  const refresh = await Promise.all([post('token', fields), post('token', fields)])
  expect(refresh.map(response => response.status).sort()).toEqual([200, 400])
})
test('userinfo rejects ID tokens, expired tokens, and wrong issuer or audience', async () => {
  for (const overrides of [{ token_use: 'id' }, { iss: 'https://evil.example' }, { aud: 'other-client' }, { exp: 1 }]) {
    const token = signToken({ sub: 'alice', token_use: 'access', iss: origin, aud: 'grafana', exp: Math.floor(Date.now() / 1000) + 60, ...overrides })
    const response = await app.handle(new Request(origin + '/radius_login/api/oauth/userinfo', { headers: { Authorization: `Bearer ${token}` } }))
    expect(response.status).toBe(401)
  }
})
test('invalid form bodies, repeated parameters and oversized payloads are rejected', async () => {
  const duplicate = new Request(origin + '/radius_login/api/oauth/token', { method: 'POST', body: 'client_id=a&client_id=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  expect((await app.handle(duplicate)).status).toBe(400)
  const binary = new FormData(); binary.set('user', new Blob(['binary']))
  expect((await app.handle(new Request(origin + '/radius_login/api/oauth/authorize', { method: 'POST', body: binary }))).status).toBe(400)
  expect((await post('authorize', { user: 'x'.repeat(17000) })).status).toBe(413)
  expect((await app.handle(new Request(origin + '/radius_login/api/oauth/token', { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } }))).status).toBe(415)
})
test('startup rejects shipped example secrets', () => { expect(() => validateConfig(config)).toThrow() })
test('rate limiting cannot be bypassed by varying X-Forwarded-For', async () => {
  let response: Response | undefined
  for (let i = 0; i < 25; i++) response = await post('authorize', { user: 'target-user' }, { 'X-Forwarded-For': `192.0.2.${i}` })
  expect(response!.status).toBe(429)
  expect(response!.headers.get('retry-after')).toBe('60')
  expect((await authorize({ user: 'other-user' })).status).toBe(302)
  expect((await exchange(await issueCode())).status).toBe(200)
})

test('authentication concurrency is bounded without blocking completed requests', async () => {
  let release!: () => void
  authGate = new Promise<void>(resolve => { release = resolve })
  const pending = Array.from({ length: 64 }, (_, index) => authorize({ user: `parallel-${index}` }))
  try {
    for (let i = 0; i < 100 && calls < 64; i++) await Bun.sleep(1)
    expect(calls).toBe(64)
    expect((await authorize({ user: 'overflow', accept: 'json' })).status).toBe(503)
  } finally { release(); await Promise.all(pending); authGate = undefined }
  expect((await authorize({ user: 'next-login' })).status).toBe(302)
})
