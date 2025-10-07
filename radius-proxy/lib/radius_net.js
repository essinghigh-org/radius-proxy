/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')

function buildAccessRequest({ id, authenticator, username, password, secret, nasIp }) {
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

function buildAccessAccept({ id, authenticator, classValue }) {
  const attrs = []
  if (classValue) {
    const c = Buffer.from(classValue, 'utf8')
    attrs.push(Buffer.concat([Buffer.from([25, c.length + 2]), c]))
  }
  const attrBuf = attrs.length ? Buffer.concat(attrs) : Buffer.alloc(0)
  const len = 20 + attrBuf.length
  const header = Buffer.alloc(20)
  header.writeUInt8(2, 0) // Access-Accept
  header.writeUInt8(id, 1)
  header.writeUInt16BE(len, 2)
  authenticator.copy(header, 4)
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
