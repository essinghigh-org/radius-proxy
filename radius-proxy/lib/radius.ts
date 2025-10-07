import dgram from "dgram"
import crypto from "crypto"

// Minimal RADIUS client using UDP for Access-Request/Accept exchange.
// This is intentionally small and supports only PAP (User-Password) and Class attribute extraction.

export interface RadiusResult {
  ok: boolean
  class?: string
  raw?: string
}

export async function radiusAuthenticate(
  host: string,
  secret: string,
  username: string,
  password: string,
  timeout = 3000
): Promise<RadiusResult> {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket("udp4")
    const id = crypto.randomBytes(1)[0]
    const authenticator = crypto.randomBytes(16)

    const attrs: Buffer[] = []

    // User-Name (type 1)
    const userBuf = Buffer.from(username, "utf8")
    attrs.push(Buffer.concat([Buffer.from([1, userBuf.length + 2]), userBuf]))

    // User-Password (type 2) - PAP per RFC2865 with proper 16-byte block chaining
    const pwdBuf = Buffer.from(password, "utf8")
    const blockCount = Math.ceil(pwdBuf.length / 16) || 1
    const padded = Buffer.alloc(blockCount * 16, 0)
    pwdBuf.copy(padded)
    const xored = Buffer.alloc(padded.length)
    // For each 16-byte block, MD5(secret + previous) where previous is authenticator for block 0,
    // and the previous encrypted block for subsequent blocks (RFC2865 section 5.2).
    let prev = authenticator
    for (let b = 0; b < blockCount; b++) {
      const md5 = crypto.createHash("md5").update(Buffer.concat([Buffer.from(secret, "utf8"), prev])).digest()
      for (let i = 0; i < 16; i++) {
        xored[b * 16 + i] = padded[b * 16 + i] ^ md5[i]
      }
      prev = xored.slice(b * 16, b * 16 + 16)
    }
    attrs.push(Buffer.concat([Buffer.from([2, xored.length + 2]), xored]))
 
    // NAS-IP-Address (type 4) - optional, set to 127.0.0.1
    const nasIp = Buffer.from([127, 0, 0, 1])
    attrs.push(Buffer.concat([Buffer.from([4, 6]), nasIp]))
    // NAS-Port (type 5) - set to zero by default
    attrs.push(Buffer.concat([Buffer.from([5, 6]), Buffer.from([0, 0, 0, 0])]))
    // Message-Authenticator (type 80) - placeholder 16 bytes (some servers require it)
    attrs.push(Buffer.concat([Buffer.from([80, 18]), Buffer.alloc(16, 0)]))

    const attrBuf = Buffer.concat(attrs)

    const len = 20 + attrBuf.length
    const header = Buffer.alloc(20)
    header.writeUInt8(1, 0) // Access-Request
    header.writeUInt8(id, 1)
    header.writeUInt16BE(len, 2)
    authenticator.copy(header, 4)

    const packet = Buffer.concat([header, attrBuf])

    const timer = setTimeout(() => {
      client.close()
      resolve({ ok: false })
    }, timeout)

    client.on("message", (msg) => {
      clearTimeout(timer)
      client.close()
      const code = msg.readUInt8(0)
      // 2 = Access-Accept, 3 = Access-Reject
      if (code === 2) {
        // parse attributes for Class (type 25)
        let offset = 20
        let foundClass: string | undefined = undefined
        while (offset + 2 <= msg.length) {
          const t = msg.readUInt8(offset)
          const l = msg.readUInt8(offset + 1)
          if (l < 2) break
          const value = msg.slice(offset + 2, offset + l)
          if (t === 25) {
            foundClass = value.toString("utf8")
          }
          offset += l
        }
        resolve({ ok: true, class: foundClass, raw: msg.toString("hex") })
      } else {
        resolve({ ok: false, raw: msg.toString("hex") })
      }
    })

    // Compute Message-Authenticator (HMAC-MD5) per RFC2869 if present and then send.
    try {
      const hmac = crypto.createHmac('md5', Buffer.from(secret, 'utf8')).update(packet).digest()
      // find the Message-Authenticator attribute (type 80) in the packet and insert the value
      let attrOff = 20
      while (attrOff + 2 <= packet.length) {
        const t = packet.readUInt8(attrOff)
        const l = packet.readUInt8(attrOff + 1)
        if (t === 80 && l === 18) {
          for (let i = 0; i < 16; i++) packet[attrOff + 2 + i] = hmac[i]
          break
        }
        if (l < 2) break
        attrOff += l
      }
    } catch {
      // ignore hmac failures; some servers don't require Message-Authenticator
    }
 
    client.send(packet, 1812, host, (err) => {
      if (err) {
        clearTimeout(timer)
        client.close()
        reject(err)
      }
    })
  })
}
