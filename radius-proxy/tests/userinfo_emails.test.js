import assert from 'assert'
import path from 'path'
import { fileURLToPath } from 'url'
import { signToken } from '../lib/jwt.ts'
import { config } from '../lib/config.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function run() {
  const username = 'testuser'
  const token = signToken({ sub: username, role: 'Viewer', name: username, email: `${username}@${config.EMAIL_SUFFIX}` })
  const modPath = path.join(__dirname, '../app/radius_login/api/oauth/userinfo/emails/route.ts')
  // Dynamic import via transpilation (Bun can import TS directly)
  const { GET } = await import(modPath)
  const req = new Request('http://localhost/radius_login/api/oauth/userinfo/emails', { headers: { authorization: 'Bearer ' + token } })
  const res = await GET(req)
  const json = await res.json()
  assert.ok(Array.isArray(json), 'Response should be array')
  assert.ok(json.length === 1, 'Should have one email')
  assert.strictEqual(json[0].email, `${username}@${config.EMAIL_SUFFIX}`)
  assert.strictEqual(json[0].primary, true)
  console.log('userinfo emails endpoint test passed')
}

run().catch(e=>{console.error(e); process.exit(2)})
