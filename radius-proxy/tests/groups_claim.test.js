import assert from 'assert'
import { signToken, verifyToken } from '../lib/jwt.ts'

async function run() {
  // directly craft a token with groups
  const token = signToken({ sub: 'alice', name: 'alice', email: 'alice@example.local', groups: ['admin'] })
  const decoded = verifyToken(token)
  assert.ok(decoded)
  assert.strictEqual(decoded.groups[0], 'admin')
  console.log('groups claim basic test passed')
}

run().catch(e=>{console.error(e); process.exit(2)})
