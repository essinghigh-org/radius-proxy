const assert = require('assert')
const { buildAccessRequest, buildAccessAccept, parseAccessResponse } = require('../lib/radius_net')

function testBuildParse() {
  const id = 42
  const auth = Buffer.alloc(16, 1)
  const packet = buildAccessRequest({ id, authenticator: auth, username: 'u', password: 'p', secret: 's', nasIp: '127.0.0.1' })
  // We expect a buffer and a header code of 1
  assert.strictEqual(packet.readUInt8(0), 1)
  const accept = buildAccessAccept({ id, authenticator: auth, classValue: 'admin_group' })
  const parsed = parseAccessResponse(accept)
  assert.strictEqual(parsed.code, 2)
  assert.strictEqual(parsed.class, 'admin_group')
  console.log('radius_net build/parse unit test passed')
}

async function testIntegration() {
  // start a fake UDP server that will echo an Access-Accept
  const dgram = require('dgram')
  const server = dgram.createSocket('udp4')
  server.on('message', (msg, rinfo) => {
    const id = msg.readUInt8(1)
    const auth = msg.slice(4, 20)
    const { buildAccessAccept } = require('../lib/radius_net')
    const resp = buildAccessAccept({ id, authenticator: auth, classValue: 'test_group' })
    server.send(resp, rinfo.port, rinfo.address)
  })
  await new Promise((r) => server.bind(18121, '127.0.0.1', r))

  const { sendRequest } = require('../lib/radius_client')
  const res = await sendRequest({ host: '127.0.0.1', port: 18121, secret: 's', username: 'u', password: 'p', nasIp: '127.0.0.1' })
  server.close()
  if (!res.ok) throw new Error('did not receive response')
  const { parseAccessResponse } = require('../lib/radius_net')
  const parsed = parseAccessResponse(res.msg)
  assert.strictEqual(parsed.code, 2)
  assert.strictEqual(parsed.class, 'test_group')
  console.log('radius_net integration test passed')
}

async function run() {
  testBuildParse()
  await testIntegration()
}

run().then(()=>process.exit(0)).catch((e)=>{console.error(e); process.exit(2)})
