/* eslint-disable @typescript-eslint/no-require-imports */
const dgram = require('dgram')
const crypto = require('crypto')
const assert = require('assert')
const os = require('os')

function radiusAuthenticate(host, secret, username, password, timeout = 5000) {
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
    attrs.push(Buffer.concat([Buffer.from([4,6]), nasIpBuf]))
    // NAS-Port (type 5) set to 0
    attrs.push(Buffer.concat([Buffer.from([5,6]), Buffer.from([0,0,0,0])]))
    // Message-Authenticator (type 80) 16 bytes zero as placeholder (servers may require it)
    attrs.push(Buffer.concat([Buffer.from([80,18]), Buffer.alloc(16, 0)]))

    const attrBuf = Buffer.concat(attrs)
    const len = 20 + attrBuf.length
    const header = Buffer.alloc(20)
    header.writeUInt8(1,0)
    header.writeUInt8(id,1)
    header.writeUInt16BE(len,2)
    authenticator.copy(header,4)
    const packet = Buffer.concat([header, attrBuf])

    // bind the socket source address so NAS-IP matches the outbound IP
    try {
      client.bind(0, nasIpStr)
    } catch {
      // binding may fail in some environments; ignore and proceed
    }

    const timer = setTimeout(()=>{
      client.close()
      resolve({ ok: false, reason: 'timeout' })
    }, timeout)

    client.on('message', (msg)=>{
      clearTimeout(timer)
      client.close()
      const code = msg.readUInt8(0)
      if (code === 2) {
        let offset = 20
        let foundClass = undefined
        while (offset + 2 <= msg.length) {
          const t = msg.readUInt8(offset)
          const l = msg.readUInt8(offset+1)
          if (l < 2) break
          const value = msg.slice(offset+2, offset+l)
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

    client.send(packet, 1812, host, (err)=>{
      if (err) { clearTimeout(timer); client.close(); reject(err) }
    })
  })
}

async function run() {
  const host = process.env.RADIUS_HOST || '192.168.0.191'
  const secret = process.env.RADIUS_SECRET || 'testing123'
  const user = process.env.RADIUS_USER || 'admin'
  const pass = process.env.RADIUS_PASS || 'testpassword'

  console.log(`Testing RADIUS auth to ${host} user=${user} (NAS-IP=${process.env.NAS_IP || 'auto-detected'})`)

  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Attempt ${attempt}/${maxAttempts}...`)
    try {
      const res = await radiusAuthenticate(host, secret, user, pass)
      console.log('Result:', res)
      assert.strictEqual(res.ok, true, `Expected Access-Accept but got ${JSON.stringify(res)}`)
      if (res.class) {
        console.log('Found Class attribute:', res.class)
      } else {
        console.warn('No Class attribute found in Access-Accept')
      }
      console.log('RADIUS test passed')
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
      process.exit(2)
    }
  }
}

run()
