const dgram = require('dgram')
const crypto = require('crypto')

function radiusAuthenticate(host, secret, username, password, timeout = 3000) {
  return new Promise((resolve, reject) => {
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

    const nasIp = Buffer.from([127,0,0,1])
    attrs.push(Buffer.concat([Buffer.from([4,6]), nasIp]))

    const attrBuf = Buffer.concat(attrs)
    const len = 20 + attrBuf.length
    const header = Buffer.alloc(20)
    header.writeUInt8(1,0)
    header.writeUInt8(id,1)
    header.writeUInt16BE(len,2)
    authenticator.copy(header,4)
    const packet = Buffer.concat([header, attrBuf])

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

    client.send(packet, 1812, host, (err)=>{
      if (err) { clearTimeout(timer); client.close(); reject(err) }
    })
  })
}

async function main(){
  const host = process.argv[2] || '192.168.0.191'
  const secret = process.argv[3] || 'testing123'
  const user = process.argv[4] || 'admin'
  const pass = process.argv[5] || 'testpassword'
  console.log('Testing RADIUS auth to', host, 'user', user)
  try {
    const res = await radiusAuthenticate(host, secret, user, pass)
    console.log('Result:', res)
  } catch (e) {
    console.error('Error:', e)
  }
}

main()
