import assert from 'assert'
import dgram from 'dgram'
import { radiusAuthenticate } from '../lib/radius.ts'

async function run() {
  const radiusNet = await import('../lib/radius_net.js')
  const { buildAccessAccept } = radiusNet

  // Ephemeral UDP server that responds with Access-Accept containing a Class attribute.
  const server = dgram.createSocket('udp4')
  server.on('message', (msg, rinfo) => {
    try {
      const id = msg.readUInt8(1)
      const auth = msg.slice(4, 20)
      const resp = buildAccessAccept({ id, authenticator: auth, classValue: 'ts_group' })
      server.send(resp, rinfo.port, rinfo.address)
    } catch (e) {
      // ignore malformed packets
    }
  })
  await new Promise((r) => server.bind(0, '127.0.0.1', r))
  const port = server.address().port
  const host = '127.0.0.1'
  console.log(`Started fake RADIUS server on ${host}:${port} for radius.ts test`)

  const res = await radiusAuthenticate(host, 's', 'u', 'p', 5000, port)
  console.log('Result:', res)
  assert.strictEqual(res.ok, true, 'Expected Access-Accept from fake server')
  assert.strictEqual(res.class, 'ts_group', 'Class attribute should be parsed correctly')

  server.close()
  console.log('radius.ts integration test passed')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })