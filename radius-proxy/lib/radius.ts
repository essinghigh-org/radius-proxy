import dgram from "dgram"
import crypto from "crypto"
import { warn, debug } from "@/lib/log"
import { config } from "@/lib/config"
import { notifyAuthTimeout } from "@/lib/radius_hosts"

// Minimal RADIUS client using UDP for Access-Request/Accept exchange.
// This is intentionally small and supports only PAP (User-Password) and Class attribute extraction.

export interface RadiusResult {
  ok: boolean
  class?: string
  raw?: string
}

export async function radiusAuthenticate(
  host: string,
  username: string,
  password: string,
  timeoutMs?: number,
  port: number = config.RADIUS_PORT || 1812,
  notifyTimeout = true
): Promise<RadiusResult> {
  const secret = config.RADIUS_SECRET;
  if (!username || Buffer.byteLength(username) > 253 || !password || Buffer.byteLength(password) > 128) throw new Error('Invalid RADIUS credentials length')
  debug('[radius] authenticate start', { host, user: username })
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket("udp4")
    let settled = false
    const notifyFailure = () => {
      if (notifyTimeout) notifyAuthTimeout().catch(e => warn('[radius] host health update failed', e))
    }
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { client.close() } catch {}
      notifyFailure()
      reject(err)
    }
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
    const effectiveTimeoutMs = typeof timeoutMs === 'number'
      ? timeoutMs
      : (Number(config.RADIUS_TIMEOUT || 5) * 1000)

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      client.close()
      notifyFailure()
      resolve({ ok: false })
    }, effectiveTimeoutMs)

    client.on("message", (msg) => {
      if (settled) return
      // Ignore unauthenticated or malformed packets without ending the real request.
      if (msg.length < 20 || msg.length > 4096 || msg[1] !== id || msg.readUInt16BE(2) !== msg.length || ![2, 3, 11].includes(msg[0])) return
      let offset = 20
      let messageAuthenticator = -1
      while (offset < msg.length) {
        if (offset + 2 > msg.length) return
        const length = msg[offset + 1]
        if (length < 2 || offset + length > msg.length) return
        if (msg[offset] === 80) {
          if (length !== 18 || messageAuthenticator !== -1) return
          messageAuthenticator = offset + 2
        }
        offset += length
      }
      // Require Message-Authenticator to resist forged RADIUS responses (Blast-RADIUS).
      if (messageAuthenticator < 0) {
        warn('[radius] dropping response without Message-Authenticator; enable it on the RADIUS server', { host })
        return
      }
      const responseAuth = crypto.createHash('md5').update(Buffer.concat([msg.subarray(0, 4), authenticator, msg.subarray(20), Buffer.from(secret)])).digest()
      if (!crypto.timingSafeEqual(responseAuth, msg.subarray(4, 20))) return
      const authenticated = Buffer.from(msg)
      authenticator.copy(authenticated, 4)
      authenticated.fill(0, messageAuthenticator, messageAuthenticator + 16)
      const mac = crypto.createHmac('md5', secret).update(authenticated).digest()
      if (!crypto.timingSafeEqual(mac, msg.subarray(messageAuthenticator, messageAuthenticator + 16))) return
      settled = true
      clearTimeout(timer)
      client.close()
      const code = msg[0]

      // 2 = Access-Accept, 3 = Access-Reject
      if (code === 2) {
        // parse attributes for Class (type 25) - handle multiple classes and validate properly
        let offset = 20
        let foundClass: string | undefined = undefined
        const allClasses: string[] = []

        while (offset + 2 <= msg.length) {
          const t = msg.readUInt8(offset)
          const l = msg.readUInt8(offset + 1)

          // Validate attribute length per RFC 2865
          if (l < 2) {
            warn('[radius] invalid attribute length < 2; stopping parse')
            break
          }

          // ensure attribute does not run past the end of the packet
          if (offset + l > msg.length) {
            warn('[radius] attribute length runs past packet end; stopping parse')
            break
          }

          const value = msg.slice(offset + 2, offset + l)

          // Check if this is our target attribute
          let isTargetAttribute = false
          let extractedValue: string | undefined = undefined

          if (t === config.RADIUS_ASSIGNMENT) {
            if (t === 26 && config.RADIUS_VENDOR_ID !== undefined && config.RADIUS_VENDOR_TYPE !== undefined) {
              // Vendor-Specific Attribute (VSA) parsing
              if (value.length >= 6) {
                const vendorId = value.readUInt32BE(0)
                const vendorType = value.readUInt8(4)
                const vendorLength = value.readUInt8(5)

                if (vendorId === config.RADIUS_VENDOR_ID && vendorType === config.RADIUS_VENDOR_TYPE) {
                  if (vendorLength < 2 || vendorLength + 4 > value.length) { resolve({ ok: false }); return }
                  const vendorValue = value.slice(6, 6 + vendorLength - 2).toString("utf8")

                  if (config.RADIUS_VALUE_PATTERN) {
                    // Extract value using regex pattern
                    const regex = new RegExp(config.RADIUS_VALUE_PATTERN)
                    const match = vendorValue.match(regex)
                    if (match && match[1]) {
                      extractedValue = match[1]
                      isTargetAttribute = true
                    }
                  } else {
                    // Use the full vendor value
                    extractedValue = vendorValue
                    isTargetAttribute = true
                  }
                }
              }
            } else {
              // Regular attribute parsing
              const attributeValue = value.toString("utf8")

              if (config.RADIUS_VALUE_PATTERN) {
                // Extract value using regex pattern
                const regex = new RegExp(config.RADIUS_VALUE_PATTERN)
                const match = attributeValue.match(regex)
                if (match && match[1]) {
                  extractedValue = match[1]
                  isTargetAttribute = true
                }
              } else {
                // Use the full attribute value
                extractedValue = attributeValue
                isTargetAttribute = true
              }
            }
          }

          if (isTargetAttribute && extractedValue !== undefined) {
            allClasses.push(extractedValue)
            // Take the first assignment attribute encountered per RFC 2865 implementation choice
            if (!foundClass) {
              foundClass = extractedValue
            }
          }

          offset += l
        }

        resolve({ ok: true, class: allClasses.join(";") || foundClass, raw: msg.toString("hex") })
      } else {
        resolve({ ok: false, raw: msg.toString("hex") })
      }
    })

    client.on("error", fail)

    // HMAC failures must fail closed.
    try {
      const hmac = crypto.createHmac('md5', secret).update(packet).digest()
      hmac.copy(packet, packet.length - 16)
      // Connected UDP filters replies to the configured server address and port.
      client.connect(port, host, () => {
        client.send(packet, err => {
          if (err) fail(err)
        })
      })
    } catch (err) {
      fail(err as Error)
    }
  })
}
