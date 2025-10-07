import assert from 'assert'
import dgram from 'dgram'
import { radiusAuthenticate } from '../lib/radius.ts'

// This test verifies standard Response-Authenticator verification and the legacy
// behavior where some servers echo the Request Authenticator. It uses ephemeral
// UDP servers to simulate both behaviours.
async function run() {
  const { buildAccessAccept } = await import('../lib/radius_net.js')

  // --- Good server: computes correct Response-Authenticator using shared secret ---
  const serverGood = dgram.createSocket('udp4')
  serverGood.on('message', (msg, rinfo) => {
    try {
      const id = msg.readUInt8(1)
      const auth = msg.slice(4, 20)
      const resp = buildAccessAccept({ id, authenticator: auth, classValue: 'good_group', secret: 's' })
      serverGood.send(resp, rinfo.port, rinfo.address)
    } catch (e) {
      // ignore malformed packets
    }
  })
  await new Promise((r) => serverGood.bind(0, '127.0.0.1', r))
  const portGood = serverGood.address().port

  const resGood = await radiusAuthenticate('127.0.0.1', 's', 'u', 'p', 3000, portGood)
  assert.strictEqual(resGood.ok, true, 'Expected authenticator-verified Access-Accept')
  assert.strictEqual(resGood.class, 'good_group', 'Class attribute should be present for good server')
  serverGood.close()

  // --- Legacy server: echoes Request Authenticator in Response (accepted with warning) ---
  const serverLegacy = dgram.createSocket('udp4')
  serverLegacy.on('message', (msg, rinfo) => {
    try {
      const id = msg.readUInt8(1)
      const auth = msg.slice(4, 20)
      // Do not provide secret so buildAccessAccept copies request authenticator (legacy)
      const resp = buildAccessAccept({ id, authenticator: auth, classValue: 'legacy_group' })
      serverLegacy.send(resp, rinfo.port, rinfo.address)
    } catch (e) {
      // ignore malformed packets
    }
  })
  await new Promise((r) => serverLegacy.bind(0, '127.0.0.1', r))
  const portLegacy = serverLegacy.address().port

  const resLegacy = await radiusAuthenticate('127.0.0.1', 's', 'u', 'p', 3000, portLegacy)
  assert.strictEqual(resLegacy.ok, true, 'Expected legacy-echoreply Access-Accept to be accepted')
  assert.strictEqual(resLegacy.class, 'legacy_group', 'Class attribute should be present for legacy server')
  serverLegacy.close()

  console.log('authenticator behavior tests passed')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })