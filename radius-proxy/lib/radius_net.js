/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')

function buildAccessRequest({ id, authenticator, username, password, secret, nasIp }) {
  const attrs = []
  const userBuf = Buffer.from(username, 'utf8')
  attrs.push(Buffer.concat([Buffer.from([1, userBuf.length + 2]), userBuf]))

  const pwdBuf = Buffer.from(password, 'utf8')
  // Ensure we always allocate at least one 16-byte block (RFC2865 requires a minimum of 16 bytes)
  const blockCount = Math.max(1, Math.ceil(pwdBuf.length / 16))
  const padded = Buffer.alloc(blockCount * 16, 0)
  pwdBuf.copy(padded)
  const xored = Buffer.alloc(padded.length)

  // Proper PAP encryption: MD5(secret + previous) per 16-byte block, chaining previous encrypted block
  let prev = authenticator
  for (let b = 0; b < blockCount; b++) {
    const md5 = crypto.createHash('md5').update(Buffer.concat([Buffer.from(secret, 'utf8'), prev])).digest()
    for (let i = 0; i < 16; i++) {
      xored[b * 16 + i] = padded[b * 16 + i] ^ md5[i]
    }
    prev = xored.slice(b * 16, b * 16 + 16)
  }
  attrs.push(Buffer.concat([Buffer.from([2, xored.length + 2]), xored]))

  const nasBuf = Buffer.from(nasIp.split('.').map((p) => Number(p)))
  attrs.push(Buffer.concat([Buffer.from([4, 6]), nasBuf]))

  const attrBuf = attrs.length ? Buffer.concat(attrs) : Buffer.alloc(0)
  const len = 20 + attrBuf.length
  const header = Buffer.alloc(20)
  header.writeUInt8(1, 0)
  header.writeUInt8(id, 1)
  header.writeUInt16BE(len, 2)
  authenticator.copy(header, 4)
  return Buffer.concat([header, attrBuf])
}

function buildAccessAccept({ id, authenticator, classValue, secret }) {
  const attrs = []
  if (classValue) {
    const c = Buffer.from(classValue, 'utf8')
    attrs.push(Buffer.concat([Buffer.from([25, c.length + 2]), c]))
  }
  const attrBuf = attrs.length ? Buffer.concat(attrs) : Buffer.alloc(0)
  const len = 20 + attrBuf.length

  // Build header with a placeholder authenticator; we'll compute the correct response
  // authenticator (MD5) per RFC2865 when a shared secret is supplied.
  const header = Buffer.alloc(20)
  header.writeUInt8(2, 0) // Access-Accept
  header.writeUInt8(id, 1)
  header.writeUInt16BE(len, 2)
  // default to zeros while we compute the real authenticator
  header.fill(0, 4, 20)

  // If a secret is provided, compute the Response Authenticator:
  // MD5(Code + Identifier + Length + RequestAuthenticator + Attributes + SharedSecret)
  if (secret) {
    try {
      const lenBuf = Buffer.alloc(2)
      lenBuf.writeUInt16BE(len, 0)
      const toHash = Buffer.concat([
        Buffer.from([2]), // Code = Access-Accept
        Buffer.from([id]), // Identifier
        lenBuf,
        authenticator, // Request Authenticator (from original request)
        attrBuf,
        Buffer.from(String(secret), 'utf8'),
      ])
      const respAuth = crypto.createHash('md5').update(toHash).digest()
      respAuth.copy(header, 4)
    } catch {
      // If computation fails fall back to copying request authenticator to remain compatible.
      authenticator.copy(header, 4)
    }
  } else {
    // Backwards-compatible behavior: copy the provided authenticator
    authenticator.copy(header, 4)
  }

  return Buffer.concat([header, attrBuf])
}

function parseAccessResponse(msg) {
  const code = msg.readUInt8(0)
  const res = { code, class: undefined }
  if (code !== 2) return res
  let offset = 20
  while (offset + 2 <= msg.length) {
    const t = msg.readUInt8(offset)
    const l = msg.readUInt8(offset + 1)
    if (l < 2) break
    // ensure attribute length does not run past end of packet
    if (offset + l > msg.length) break
    const value = msg.slice(offset + 2, offset + l)
    if (t === 25) res.class = value.toString('utf8')
    offset += l
  }
  return res
}

module.exports = { buildAccessRequest, buildAccessAccept, parseAccessResponse }
