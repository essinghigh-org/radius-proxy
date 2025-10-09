import assert from 'assert'
import dgram from 'dgram'
import crypto from 'crypto'

// Ensure deterministic JWT keys for the test run
process.env.NODE_ENV = 'test'

async function run() {
  // Start a fake RADIUS server that always returns Access-Accept with a Class attribute.
  const { buildAccessAccept } = await import('../lib/radius_net.js')
  const server = dgram.createSocket('udp4')
  server.on('message', (msg, rinfo) => {
    try {
      const id = msg.readUInt8(1)
      const auth = msg.slice(4, 20)
      const resp = buildAccessAccept({ id, authenticator: auth, classValue: 'test_group' })
      server.send(resp, rinfo.port, rinfo.address)
    } catch {
      // ignore malformed packets
    }
  })
  await new Promise((r) => server.bind(0, '127.0.0.1', r))
  const port = server.address().port
  const host = '127.0.0.1'
  console.log(`Started fake RADIUS server on ${host}:${port} for oauth refresh integration test`)

  // Point the app configuration at our fake server BEFORE importing the route modules
  process.env.RADIUS_HOST = host
  process.env.RADIUS_PORT = String(port)
  process.env.RADIUS_SECRET = 's' // secret the fake server expects (not validated by fake server)
  process.env.PERMITTED_CLASSES = 'test_group'
  process.env.REDIRECT_URIS = 'http://localhost/callback'
  process.env.OAUTH_CLIENT_ID = 'grafana'
  process.env.OAUTH_CLIENT_SECRET = 'secret'
  process.env.OAUTH_REFRESH_TOKEN_TTL = '3600'
  process.env.EMAIL_SUFFIX = 'example.com'
  process.env.ADMIN_CLASSES = 'test_group'

  // Import the authorize and token routes after env is set so config is derived correctly.
  const authModule = await import('../app/radius_login/api/oauth/authorize/route.ts')
  const authorizePOST = authModule.POST
  const tokenModule = await import('../app/radius_login/api/oauth/token/route.ts')
  const tokenPOST = tokenModule.POST
  const { getStorage } = await import('../lib/storage.ts')
  const storage = getStorage()

  // 1. Authorize and get a code
  const form = new URLSearchParams({
    user: 'u',
    password: 'p',
    client_id: 'grafana',
    redirect_uri: 'http://localhost/callback',
    state: 's123',
  }).toString()

  const authReq = new Request('http://localhost/radius_login/api/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })

  const authRes = await authorizePOST(authReq)
  const location = authRes.headers.get('location') || authRes.headers.get('Location')
  const code = new URL(location).searchParams.get('code')

  // 2. Exchange code for tokens
  const creds = Buffer.from('grafana:secret').toString('base64')
  const tokenForm = new URLSearchParams({ grant_type: 'authorization_code', code }).toString()
  const tokenReq = new Request('http://localhost/radius_login/api/oauth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + creds,
    },
    body: tokenForm,
  })
  const tokenRes = await tokenPOST(tokenReq)
  const json = await tokenRes.json()
  const refreshToken = json.refresh_token

  assert.ok(refreshToken, 'refresh_token missing')

  // 3. Use refresh token to get new tokens
  const refreshForm = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString()
  const refreshReq = new Request('http://localhost/radius_login/api/oauth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + creds,
    },
    body: refreshForm,
  })

  const refreshRes = await tokenPOST(refreshReq)
  const refreshJson = await refreshRes.json()

  assert.strictEqual(refreshRes.status, 200, `Expected status 200, got ${refreshRes.status}`)
  assert.ok(refreshJson.access_token, 'new access_token missing')
  assert.ok(refreshJson.refresh_token, 'new refresh_token missing')
  assert.notStrictEqual(refreshToken, refreshJson.refresh_token, 'refresh token should be rotated')

  // 4. Verify old refresh token is invalid
  const oldRefreshForm = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString()
  const oldRefreshReq = new Request('http://localhost/radius_login/api/oauth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + creds,
    },
    body: oldRefreshForm,
  })
  const oldRefreshRes = await tokenPOST(oldRefreshReq)
  const oldRefreshJson = await oldRefreshRes.json()
  assert.strictEqual(oldRefreshRes.status, 400, `Expected status 400, got ${oldRefreshRes.status}`)
  assert.strictEqual(oldRefreshJson.error, 'invalid_grant', 'Expected invalid_grant error')

  // 5. Test expired refresh token
  const expiredRefreshToken = crypto.randomBytes(32).toString('base64url')
  const expiredEntry = {
    username: 'testuser',
    class: 'admin_group',
    scope: 'openid profile',
    groups: ['admin_group'],
    expiresAt: Date.now() - 1000, // Expired 1 second ago
    clientId: 'grafana'
  }
  await storage.setRefreshToken(expiredRefreshToken, expiredEntry)
  const expiredRefreshForm = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: expiredRefreshToken }).toString()
  const expiredRefreshReq = new Request('http://localhost/radius_login/api/oauth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + creds,
    },
    body: expiredRefreshForm,
  })
  const expiredRefreshRes = await tokenPOST(expiredRefreshReq)
  const expiredRefreshJson = await expiredRefreshRes.json()
  assert.strictEqual(expiredRefreshRes.status, 400, `Expected status 400, got ${expiredRefreshRes.status}`)
  assert.strictEqual(expiredRefreshJson.error, 'invalid_grant', 'Expected invalid_grant error for expired token')

  server.close()
  console.log('oauth refresh integration test passed')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
