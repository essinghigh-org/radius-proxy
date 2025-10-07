/* eslint-disable @typescript-eslint/no-require-imports */
const dgram = require('dgram')
const crypto = require('crypto')
const assert = require('assert')
const os = require('os')

function radiusAuthenticate(host, secret, username, password, timeout = 5000, port = 1812) {
  return new Promise((resolve, reject) => {
    // determine NAS-IP-Address: prefer a non-loopback IPv4 of the host
    function detectLocalIPv4() {
      const nets = os.networkInterfaces()
      for (const name of Object.keys(nets)) {
        for (const iface of nets[name]) {
          if (iface.family === 'IPv4' && !iface.internal) return iface.address
        }
      }
      return '127.0.0.1'
    }

    const nasIpStr = process.env.NAS_IP || detectLocalIPv4()
    const nasParts = nasIpStr.split('.').map((p) => Number(p))
    const nasIpBuf = Buffer.from(nasParts)

    const client = dgram.createSocket('udp4')
    const id = crypto.randomBytes(1)[0]
    const authenticator = crypto.randomBytes(16)

    const attrs = []
    const userBuf = Buffer.from(username, 'utf8')
    attrs.push(Buffer.concat([Buffer.from([1, userBuf.length + 2]), userBuf]))

    const pwdBuf = Buffer.from(password, 'utf8')
    const padded = Buffer.alloc(Math.ceil(pwdBuf.length / 16) * 16, 0)
    pwdBuf.copy(padded)
    const md5 = crypto.createHash('md5').update(Buffer.concat([Buffer.from(secret, 'utf8'), authenticator])).digest()
    const xored = Buffer.alloc(padded.length)
    for (let i = 0; i < padded.length; i++) xored[i] = padded[i] ^ md5[i % 16]
    attrs.push(Buffer.concat([Buffer.from([2, xored.length + 2]), xored]))

    // NAS-IP-Address (type 4)
    attrs.push(Buffer.concat([Buffer.from([4, 6]), nasIpBuf]))
    // NAS-Port (type 5) set to 0
    attrs.push(Buffer.concat([Buffer.from([5, 6]), Buffer.from([0, 0, 0, 0])]))
    // Message-Authenticator (type 80) 16 bytes zero as placeholder (servers may require it)
    attrs.push(Buffer.concat([Buffer.from([80, 18]), Buffer.alloc(16, 0)]))

    const attrBuf = Buffer.concat(attrs)
    const len = 20 + attrBuf.length
    const header = Buffer.alloc(20)
    header.writeUInt8(1, 0)
    header.writeUInt8(id, 1)
    header.writeUInt16BE(len, 2)
    authenticator.copy(header, 4)
    const packet = Buffer.concat([header, attrBuf])

    // bind the socket source address so NAS-IP matches the outbound IP
    // Only bind if the NAS_IP environment variable was explicitly provided by the user.
    // If NAS_IP is auto-detected, skip binding so that sending to loopback addresses
    // uses the kernel's loopback routing (avoids source interface mismatches).
    if (process.env.NAS_IP) {
      try {
        client.bind(0, nasIpStr)
        console.log(`[test] client bound to ${nasIpStr}`)
      } catch {
        console.log('[test] client bind failed; OS will pick source address')
      }
    } else {
      console.log('[test] NAS_IP not set; skipping explicit bind so OS chooses the correct source')
    }

    const timer = setTimeout(() => {
      client.close()
      resolve({ ok: false, reason: 'timeout' })
    }, timeout)

    client.on('message', (msg) => {
      clearTimeout(timer)
      client.close()
      const code = msg.readUInt8(0)
      if (code === 2) {
        let offset = 20
        let foundClass = undefined
        while (offset + 2 <= msg.length) {
          const t = msg.readUInt8(offset)
          const l = msg.readUInt8(offset + 1)
          if (l < 2) break
          const value = msg.slice(offset + 2, offset + l)
          if (t === 25) foundClass = value.toString('utf8')
          offset += l
        }
        resolve({ ok: true, class: foundClass, raw: msg.toString('hex') })
      } else {
        resolve({ ok: false, code, raw: msg.toString('hex') })
      }
    })
    // Compute Message-Authenticator (HMAC-MD5) per RFC2869
    try {
      const hmac = crypto.createHmac('md5', Buffer.from(secret, 'utf8')).update(packet).digest()
      // find the Message-Authenticator attribute (type 80) in the packet and insert the value
      let attrOff = 20
      while (attrOff + 2 <= packet.length) {
        const t = packet.readUInt8(attrOff)
        const l = packet.readUInt8(attrOff + 1)
        if (t === 80 && l === 18) {
          // copy hmac into packet at attrOff+2
          for (let i = 0; i < 16; i++) packet[attrOff + 2 + i] = hmac[i]
          break
        }
        if (l < 2) break
        attrOff += l
      }
    } catch {
      // ignore hmac failures and send packet (server may not require it)
    }

    client.send(packet, port, host, (err) => {
      if (err) { clearTimeout(timer); client.close(); reject(err) }
    })
  })
}

async function run() {
  const envHost = process.env.RADIUS_HOST
  let host = envHost || undefined
  let port = Number(process.env.RADIUS_PORT) || 1812
  const secret = process.env.RADIUS_SECRET || 'testing123'
  const user = process.env.RADIUS_USER || 'admin'
  const pass = process.env.RADIUS_PASS || 'testpassword'

  // If no external RADIUS_HOST is provided, start an ephemeral fake RADIUS UDP server
  // so unit tests can run offline and deterministically.
  let server
  if (!envHost) {
    const dgram = require('dgram')
    const { buildAccessAccept } = require('../lib/radius_net')
    server = dgram.createSocket('udp4')
    server.on('message', (msg, rinfo) => {
      try {
        console.log(`[test-server] received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`)
        // show a short hex prefix to avoid flooding
        console.log('[test-server] pkt:', msg.toString('hex').slice(0, 120))
        const id = msg.readUInt8(1)
        const auth = msg.slice(4, 20)
        // Provide the shared secret so the response authenticator is computed per RFC2865
        const resp = buildAccessAccept({ id, authenticator: auth, classValue: 'test_group', secret })
        server.send(resp, rinfo.port, rinfo.address)
      } catch {
        // ignore malformed packets in the fake server
      }
    })
    // Bind on all interfaces so we receive requests regardless of the client's source IP
    await new Promise((r) => server.bind(0, '0.0.0.0', r))
    port = server.address().port
    host = '127.0.0.1'
    console.log(`Started fake RADIUS server on 0.0.0.0:${port} (serving ${host}) for tests`)
  }

  console.log(`Testing RADIUS auth to ${host}:${port} user=${user} (NAS-IP=${process.env.NAS_IP || 'auto-detected'})`)

  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Attempt ${attempt}/${maxAttempts}...`)
    try {
      const res = await radiusAuthenticate(host, secret, user, pass, 5000, port)
      console.log('Result:', res)
      assert.strictEqual(res.ok, true, `Expected Access-Accept but got ${JSON.stringify(res)}`)
      if (res.class) {
        console.log('Found Class attribute:', res.class)
      } else {
        console.warn('No Class attribute found in Access-Accept')
      }
      console.log('RADIUS test passed')
      if (server) server.close()
      process.exit(0)
    } catch (err) {
      console.error('RADIUS test attempt failed:', err && err.message ? err.message : err)
      if (attempt < maxAttempts) {
        const backoff = attempt * 500
        console.log(`Retrying in ${backoff}ms...`)
        await new Promise((r) => setTimeout(r, backoff))
        continue
      }
      console.error('All attempts failed')
      if (server) server.close()
      process.exit(2)
    }
  }
}

run()
