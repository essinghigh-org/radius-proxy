
import fs from "fs"
import path from "path"
import crypto from "crypto"
import jwt from "jsonwebtoken"

type RSKeyInfo = { algo: "RS256"; privateKey: string; publicKey: string; kid: string }
type HSKeyInfo = { algo: "HS256"; secret: string }
type KeyInfo = RSKeyInfo | HSKeyInfo

const KEY_DIR = path.resolve(process.cwd(), ".keys")

function ensureKeyDir() {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true })
}

function loadOrCreateKeys(): KeyInfo {
  // Prefer environment-supplied PEM keys
  const privEnv = process.env.JWT_PRIVATE_KEY || ""
  const pubEnv = process.env.JWT_PUBLIC_KEY || ""
  if (privEnv && pubEnv) {
    const kid = crypto.createHash('sha256').update(pubEnv).digest('base64url')
    return { algo: "RS256", privateKey: privEnv, publicKey: pubEnv, kid }
  }

  ensureKeyDir()
  const privPath = path.join(KEY_DIR, "jwt.key")
  const pubPath = path.join(KEY_DIR, "jwt.pub")

  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    const privateKey = fs.readFileSync(privPath, "utf8")
    const publicKey = fs.readFileSync(pubPath, "utf8")
    const kid = crypto.createHash('sha256').update(publicKey).digest('base64url')
    return { algo: "RS256", privateKey, publicKey, kid }
  }

  // Attempt to generate an RSA keypair
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    })
    fs.writeFileSync(privPath, privateKey, { mode: 0o600 })
    fs.writeFileSync(pubPath, publicKey)
    const kid = crypto.createHash('sha256').update(publicKey).digest('base64url')
    return { algo: "RS256", privateKey, publicKey, kid }
  } catch (err) {
    // If RSA generation fails, log and fall back to an HMAC secret
    console.error('[jwt] failed to generate RSA keypair, falling back to HS256', err)
    const secret = crypto.randomBytes(32).toString("hex")
    return { algo: "HS256", secret }
  }
}

const keyinfo: KeyInfo = loadOrCreateKeys()

export function signToken(payload: object, opts?: jwt.SignOptions) {
  if (keyinfo.algo === "RS256") {
    // jsonwebtoken library expects kid via keyid option; it adds header.kid automatically
    return jwt.sign(payload, keyinfo.privateKey, { algorithm: "RS256", keyid: keyinfo.kid, ...(opts || {}) })
  }
  return jwt.sign(payload, keyinfo.secret, { algorithm: "HS256", ...(opts || {}) })
}

export function verifyToken(token: string) {
  if (keyinfo.algo === "RS256") {
    return jwt.verify(token, keyinfo.publicKey)
  }
  return jwt.verify(token, keyinfo.secret)
}

export function getKeyInfo() {
  return keyinfo
}
