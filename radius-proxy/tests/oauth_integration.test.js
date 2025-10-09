import assert from 'assert'
import dgram from 'dgram'

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
  console.log(`Started fake RADIUS server on ${host}:${port} for oauth integration test`)

  // Point the app configuration at our fake server BEFORE importing the route modules
  process.env.RADIUS_HOST = host
  process.env.RADIUS_PORT = String(port)
  process.env.RADIUS_SECRET = 's' // secret the fake server expects (not validated by fake server)
  // Ensure the class returned by fake RADIUS server is permitted so flow continues
  process.env.PERMITTED_CLASSES = 'test_group'

  // Import the authorize route after env is set so config is derived correctly.
  const authModule = await import('../app/radius_login/api/oauth/authorize/route.ts')
  const authorizePOST = authModule.POST

  // Perform the authorize POST (simulates the login form submission)
  // Configure redirect URIs to allow our test callback explicitly
  process.env.REDIRECT_URIS = 'http://localhost/callback'

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
  // Expect a redirect to the provided redirect_uri with a code parameter
  assert.ok(authRes.status === 302 || authRes.status === 301, `Expected redirect, got status ${authRes.status}`)
  const location = authRes.headers.get('location') || authRes.headers.get('Location')
  assert.ok(location, 'Redirect Location header missing')

  const locUrl = new URL(location)
  const code = locUrl.searchParams.get('code')
  const state = locUrl.searchParams.get('state')
  assert.ok(code, 'Authorization code missing in redirect')
  assert.strictEqual(state, 's123', 'State was not preserved')

  // Exchange code for tokens via the token endpoint
  const tokenModule = await import('../app/radius_login/api/oauth/token/route.ts')
  const tokenPOST = tokenModule.POST

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
  assert.ok(json.access_token, 'access_token missing')
  assert.ok(json.id_token, 'id_token missing')
  assert.strictEqual(json.token_type, 'bearer')
  console.log('Token exchange response looks valid')

  // Verify the access token contains the groups claim derived from RADIUS Class
  const { verifyToken } = await import('../lib/jwt.ts')
  const payload = verifyToken(json.access_token)
  assert.ok(Array.isArray(payload.groups), 'groups claim missing or not an array')
  assert.ok(payload.groups.includes('test_group'), `expected 'test_group' in groups, got ${JSON.stringify(payload.groups)}`)

  server.close()
  console.log('oauth integration test passed')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })