#!/usr/bin/env node
/* Simple PKCE integration tests: S256 success/failure and plain success/failure */
const assert = require('assert')
const crypto = require('crypto')
const dgram = require('dgram')

process.env.NODE_ENV = 'test'

async function run() {
  const { buildAccessAccept } = require('../lib/radius_net.js')
  const server = dgram.createSocket('udp4')
  server.on('message', (msg, rinfo) => {
    try {
      const id = msg.readUInt8(1)
      const auth = msg.slice(4, 20)
      const resp = buildAccessAccept({ id, authenticator: auth, classValue: 'test_group' })
      server.send(resp, rinfo.port, rinfo.address)
    } catch (e) {
      // ignore
    }
  })
  await new Promise(r => server.bind(0, '127.0.0.1', r))
  const port = server.address().port
  process.env.RADIUS_HOST = '127.0.0.1'
  process.env.RADIUS_PORT = String(port)
  process.env.RADIUS_SECRET = 's'
  // Ensure redirect and permitted classes allow localhost callback
  process.env.REDIRECT_URIS = 'http://localhost/callback'
  // Set a non-empty value (single space) so the config loader treats this as an override
  // and the final parsed PERMITTED_CLASSES becomes an empty array.
  process.env.PERMITTED_CLASSES = ' '

  // Import routes
  const authModule = require('../app/radius_login/api/oauth/authorize/route.ts')
  const tokenModule = require('../app/radius_login/api/oauth/token/route.ts')
  const authorizePOST = authModule.POST
  const tokenPOST = tokenModule.POST

  // Helper: run authorize request with optional PKCE params
  async function doAuthorize({ user = 'u', password = 'p', code_challenge, code_challenge_method } = {}) {
    const body = new URLSearchParams({ user, password, client_id: 'grafana', redirect_uri: 'http://localhost/callback', state: 's123' })
    if (code_challenge) body.set('code_challenge', code_challenge)
    if (code_challenge_method) body.set('code_challenge_method', code_challenge_method)
    const req = new Request('http://localhost/radius_login/api/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })
    const res = await authorizePOST(req)
    assert.ok(res.status === 302 || res.status === 301, `Expected redirect, got ${res.status}`)
    const loc = res.headers.get('location') || res.headers.get('Location')
    assert.ok(loc)
    const u = new URL(loc)
    return u.searchParams.get('code')
  }

  // Helper: exchange code with optional code_verifier
  async function doTokenExchange(code, code_verifier) {
    const creds = Buffer.from('grafana:secret').toString('base64')
    const form = new URLSearchParams({ grant_type: 'authorization_code', code })
    if (code_verifier) form.set('code_verifier', code_verifier)
    const req = new Request('http://localhost/radius_login/api/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + creds }, body: form.toString() })
    const res = await tokenPOST(req)
    return res
  }

  // S256 success
  const verifier = crypto.randomBytes(32).toString('base64url')
  const hash = crypto.createHash('sha256').update(verifier, 'ascii').digest()
  const challenge = Buffer.from(hash).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const code1 = await doAuthorize({ code_challenge: challenge, code_challenge_method: 'S256' })
  const res1 = await doTokenExchange(code1, verifier)
  const j1 = await res1.json()
  assert.ok(j1.access_token, 'S256: expected access_token')

  // S256 failure (wrong verifier)
  const code2 = await doAuthorize({ code_challenge: challenge, code_challenge_method: 'S256' })
  const res2 = await doTokenExchange(code2, 'wrongverifier')
  const j2 = await res2.json()
  assert.strictEqual(j2.error, 'invalid_grant', 'S256 failure should return invalid_grant')

  // plain success
  const plainVerifier = crypto.randomBytes(32).toString('base64url')
  const code3 = await doAuthorize({ code_challenge: plainVerifier, code_challenge_method: 'plain' })
  const res3 = await doTokenExchange(code3, plainVerifier)
  const j3 = await res3.json()
  assert.ok(j3.access_token, 'plain: expected access_token')

  // plain failure
  const code4 = await doAuthorize({ code_challenge: plainVerifier, code_challenge_method: 'plain' })
  const res4 = await doTokenExchange(code4, 'bad')
  const j4 = await res4.json()
  assert.strictEqual(j4.error, 'invalid_grant', 'plain failure should return invalid_grant')

  server.close()
  console.log('pkce tests passed')
}

run().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1) })
