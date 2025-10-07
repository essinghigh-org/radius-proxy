/* eslint-disable @typescript-eslint/no-require-imports */
const dgram = require('dgram')
const crypto = require('crypto')
const { buildAccessRequest } = require('./radius_net')

function sendRequest({ host, port = 1812, secret, username, password, nasIp = '127.0.0.1', timeout = 2000 }) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4')
    const id = crypto.randomBytes(1)[0]
    const authenticator = crypto.randomBytes(16)
    const packet = buildAccessRequest({ id, authenticator, username, password, secret, nasIp })

    const timer = setTimeout(() => { client.close(); resolve({ ok: false, reason: 'timeout' }) }, timeout)

    client.on('message', (msg) => {
      clearTimeout(timer)
      client.close()
      resolve({ ok: true, msg })
    })

    client.send(packet, port, host, (err) => {
      if (err) { clearTimeout(timer); client.close(); return reject(err) }
    })
  })
}

module.exports = { sendRequest }
