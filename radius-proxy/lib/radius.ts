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

    // User-Password (type 2) - simple PAP per RFC2865
    const pwdBuf = Buffer.from(password, "utf8")
    const padded = Buffer.alloc(Math.ceil(pwdBuf.length / 16) * 16, 0)
    pwdBuf.copy(padded)
    const md5 = crypto.createHash("md5").update(Buffer.concat([Buffer.from(secret, "utf8"), authenticator])).digest()
    const xored = Buffer.alloc(padded.length)
    for (let i = 0; i < padded.length; i++) xored[i] = padded[i] ^ md5[i % 16]
    attrs.push(Buffer.concat([Buffer.from([2, xored.length + 2]), xored]))

    // NAS-IP-Address (type 4) - optional, set to 127.0.0.1
    const nasIp = Buffer.from([127, 0, 0, 1])
    attrs.push(Buffer.concat([Buffer.from([4, 6]), nasIp]))

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

    client.send(packet, 1812, host, (err) => {
      if (err) {
        clearTimeout(timer)
        client.close()
        reject(err)
      }
    })
  })
}
