import assert from 'assert'
import { getIssuer } from '../lib/server-utils.ts'

async function run() {
  // Simulate a request received internally on http://localhost:3000 but forwarded as https://auth.example.com
  const headers = new Headers({
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'auth.example.com',
    // internal host header might include the dev port
    'host': 'localhost:3000'
  })
  const req = new Request('http://localhost:3000/api/test', { headers })
  const origin = getIssuer(req)
  assert.strictEqual(origin, 'https://auth.example.com', 'Expected forwarded https origin without internal port')
  console.log('server utils proxy origin test passed')
}

run().catch(e=>{console.error(e); process.exit(2)})
