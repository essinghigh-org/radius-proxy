import dgram from "dgram"
import crypto from "crypto"
import { warn } from "@/lib/log"
import { config } from "@/lib/config"
 
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
  timeout?: number,
  port = 1812
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

    // Determine effective timeout in milliseconds. If caller provided a numeric
    // timeout, use it directly (assumed to be milliseconds). Otherwise fall back
    // to configured `RADIUS_TIMEOUT` (seconds) from config, defaulting to 5s.
    const effectiveTimeoutMs = typeof timeout === 'number'
      ? timeout
      : (Number(config.RADIUS_TIMEOUT || 5) * 1000)

    const timer = setTimeout(() => {
      client.close()
      resolve({ ok: false })
    }, effectiveTimeoutMs)

    client.on("message", (msg) => {
      clearTimeout(timer)
      client.close()

      // Minimal sanity checks
      if (!msg || msg.length < 20) {
        warn('[radius] received malformed response (too short)')
        resolve({ ok: false, raw: msg ? msg.toString("hex") : undefined })
        return
      }

      const code = msg.readUInt8(0)
      // Verify response authenticator per RFC2865 when secret is available to avoid spoofed replies.
      try {
        const respAuth = msg.slice(4, 20)
        // Recompute: MD5(Code + Identifier + Length + RequestAuthenticator + Attributes + SharedSecret)
        const lenBuf = Buffer.alloc(2)
        lenBuf.writeUInt16BE(msg.length, 0)
        const toHash = Buffer.concat([
          Buffer.from([msg.readUInt8(0)]),
          Buffer.from([msg.readUInt8(1)]),
          lenBuf,
          authenticator, // request authenticator we sent earlier
          msg.slice(20), // attributes from response
          Buffer.from(secret || "", "utf8"),
        ])
        const expected = crypto.createHash("md5").update(toHash).digest()
        if (!expected.equals(respAuth)) {
          // Some servers use a simple echo of the Request Authenticator (legacy behavior).
          // Accept the response if the authenticator equals the original request authenticator,
          // but emit a warning so operators can notice insecure behavior.
          if (respAuth.equals(authenticator)) {
            warn('[radius] response authenticator equals request authenticator (legacy behavior); accepting with warning')
          } else {
            warn('[radius] response authenticator mismatch; dropping response')
            resolve({ ok: false, raw: msg.toString("hex") })
            return
          }
        }
      } catch (e) {
        // Do not fail the entire flow on verification error; just warn and continue parsing.
        warn('[radius] response authenticator verification error', e)
      }

      // 2 = Access-Accept, 3 = Access-Reject
      if (code === 2) {
        // parse attributes for Class (type 25)
        let offset = 20
        let foundClass: string | undefined = undefined
        while (offset + 2 <= msg.length) {
          const t = msg.readUInt8(offset)
          const l = msg.readUInt8(offset + 1)
          if (l < 2) break
          // ensure attribute does not run past the end of the packet
          if (offset + l > msg.length) {
            warn('[radius] attribute length runs past packet end; stopping parse')
            break
          }
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

    client.on("error", (err) => {
      clearTimeout(timer)
      try { client.close() } catch {}
      reject(err)
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
 
    client.send(packet, port, host, (err) => {
      if (err) {
        clearTimeout(timer)
        client.close()
        reject(err)
      }
    })
  })
}
