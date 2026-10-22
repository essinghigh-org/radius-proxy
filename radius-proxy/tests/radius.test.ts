import { expect, spyOn, test } from 'bun:test'
import dgram from 'node:dgram'
import crypto from 'node:crypto'
import { radiusAuthenticate } from '../lib/radius'
import { radiusHostManager } from '../lib/radius_hosts'
import { config, _invalidateConfigCache } from '../lib/config'

function attr(type: number, value: Buffer | string) {
  const bytes = Buffer.from(value)
  return Buffer.concat([Buffer.from([type, bytes.length + 2]), bytes])
}
function response(request: Buffer, options: { code?: number; id?: number; mac?: boolean; corruptMac?: boolean; attributes?: Buffer } = {}) {
  const attributes: Buffer = options.attributes || attr(25, 'admin_group')
  const packet = Buffer.alloc(20 + attributes.length + (options.mac === false ? 0 : 18))
  packet[0] = options.code || 2
  packet[1] = options.id ?? request[1]
  packet.writeUInt16BE(packet.length, 2)
  request.copy(packet, 4, 4, 20)
  attributes.copy(packet, 20)
  if (options.mac !== false) {
    packet[20 + attributes.length] = 80
    packet[21 + attributes.length] = 18
    const mac = crypto.createHmac('md5', config.RADIUS_SECRET).update(packet).digest()
    if (options.corruptMac) mac[0] ^= 1
    mac.copy(packet, 22 + attributes.length)
  }
  crypto.createHash('md5').update(packet).update(config.RADIUS_SECRET).digest().copy(packet, 4)
  return packet
}
async function exchange(make: (request: Buffer) => Buffer[]) {
  const server = dgram.createSocket('udp4')
  await new Promise<void>(resolve => server.bind(0, '127.0.0.1', resolve))
  server.on('message', (request, peer) => {
    for (const packet of make(request)) server.send(packet, peer.port, peer.address)
  })
  try { return await radiusAuthenticate('127.0.0.1', 'alice', 'a-long-password-spanning-two-blocks', 120, server.address().port, false) }
  finally { server.close() }
}
test('RADIUS validates request MAC and PAP chaining and accepts authenticated multiple classes', async () => {
  const result = await exchange(request => {
    let offset = 20
    let encrypted: Buffer | undefined
    let macOffset = 0
    while (offset < request.length) {
      if (request[offset] === 2) encrypted = request.subarray(offset + 2, offset + request[offset + 1])
      if (request[offset] === 80) macOffset = offset + 2
      offset += request[offset + 1]
    }
    const copy = Buffer.from(request)
    copy.fill(0, macOffset, macOffset + 16)
    expect(crypto.createHmac('md5', config.RADIUS_SECRET).update(copy).digest('hex')).toBe(request.subarray(macOffset, macOffset + 16).toString('hex'))
    const plaintext = Buffer.alloc(encrypted!.length)
    let previous: Buffer = request.subarray(4, 20)
    for (let i = 0; i < encrypted!.length; i += 16) {
      const hash = crypto.createHash('md5').update(config.RADIUS_SECRET).update(previous).digest()
      for (let j = 0; j < 16; j++) plaintext[i + j] = encrypted![i + j] ^ hash[j]
      previous = encrypted!.subarray(i, i + 16)
    }
    expect(plaintext.toString().replace(/\0+$/, '')).toBe('a-long-password-spanning-two-blocks')
    return [response(request, { attributes: Buffer.concat([attr(25, 'admin_group'), attr(25, 'user_group')]) })]
  })
  expect(result.ok).toBe(true)
  expect(result.class).toBe('admin_group;user_group')
})
test('RADIUS rejects unsigned responses even with a valid response authenticator', async () => {
  expect((await exchange(request => [response(request, { mac: false })])).ok).toBe(false)
})
test('RADIUS rejects a bad Message-Authenticator even with a valid response authenticator', async () => {
  expect((await exchange(request => [response(request, { corruptMac: true })])).ok).toBe(false)
})
test('RADIUS ignores wrong identifiers, truncated attributes and forged responses before a valid reply', async () => {
  const result = await exchange(request => {
    const badAuth = response(request); badAuth[4] ^= 1
    const badLength = response(request); badLength.writeUInt16BE(20, 2)
    return [Buffer.from([2]), badAuth, badLength, response(request, { id: (request[1] + 1) % 256 }), response(request, { attributes: Buffer.from([25, 255, 1]) }), response(request)]
  })
  expect(result.ok).toBe(true)
})
test('authenticated rejection can be distinguished from no server response', async () => {
  const rejected = await exchange(request => [response(request, { code: 3 })])
  expect(rejected.ok).toBe(false)
  expect(rejected.raw).toBeString()
  const timeout = await exchange(() => [])
  expect(timeout.ok).toBe(false)
  expect(timeout.raw).toBeUndefined()
})
test('RADIUS rejects oversized credentials before opening a socket', async () => {
  await expect(radiusAuthenticate('127.0.0.1', 'a'.repeat(254), 'password')).rejects.toThrow()
  await expect(radiusAuthenticate('127.0.0.1', 'alice', 'a'.repeat(129))).rejects.toThrow()
})

test('connected UDP port errors notify host failover immediately', async () => {
  const server = dgram.createSocket('udp4')
  await new Promise<void>(resolve => server.bind(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise<void>(resolve => server.close(resolve))
  const notify = spyOn(radiusHostManager, 'onAuthTimeout').mockResolvedValue(undefined)
  try {
    await expect(radiusAuthenticate('127.0.0.1', 'alice', 'password', 1000, port)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    expect(notify).toHaveBeenCalledTimes(1)
  } finally { notify.mockRestore() }
})

test('foreign vendor attributes do not invalidate the configured vendor role', async () => {
  const saved = { RADIUS_ASSIGNMENT: process.env.RADIUS_ASSIGNMENT, RADIUS_VENDOR_ID: process.env.RADIUS_VENDOR_ID, RADIUS_VENDOR_TYPE: process.env.RADIUS_VENDOR_TYPE }
  process.env.RADIUS_ASSIGNMENT = '26'; process.env.RADIUS_VENDOR_ID = '9'; process.env.RADIUS_VENDOR_TYPE = '1'
  _invalidateConfigCache()
  try {
    const foreign = Buffer.alloc(6); foreign.writeUInt32BE(1234)
    const role = Buffer.from('network-admin')
    const vendor = Buffer.alloc(6 + role.length)
    vendor.writeUInt32BE(9); vendor[4] = 1; vendor[5] = 2 + role.length; role.copy(vendor, 6)
    const result = await exchange(request => [response(request, { attributes: Buffer.concat([attr(26, foreign), attr(26, vendor)]) })])
    expect(result.ok).toBe(true)
    expect(result.class).toBe('network-admin')
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    _invalidateConfigCache()
  }
})
