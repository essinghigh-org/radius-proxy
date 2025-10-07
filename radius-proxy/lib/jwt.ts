
import fs from "fs"
import path from "path"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { error, warn } from "@/lib/log"

type RSKeyInfo = { algo: "RS256"; privateKey: string; publicKey: string; kid: string }
type HSKeyInfo = { algo: "HS256"; secret: string }
type KeyInfo = RSKeyInfo | HSKeyInfo

const KEY_DIR = path.resolve(process.cwd(), ".keys")
const HMAC_PATH = path.join(KEY_DIR, "jwt.hmac")

function ensureKeyDir() {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true })
}

function loadOrCreateKeys(): KeyInfo {
  // Prefer environment-supplied PEM keys
  const privEnv = process.env.JWT_PRIVATE_KEY || ""
  const pubEnv = process.env.JWT_PUBLIC_KEY || ""
  const hmacEnv = process.env.JWT_HS256_SECRET || ""
  // If an HS256 secret is explicitly provided via env, prefer it
  if (hmacEnv) {
    return { algo: "HS256", secret: hmacEnv }
  }
  // In test environments, provide a deterministic HS256 secret so unit tests are reproducible.
  if (process.env.NODE_ENV === "test") {
    try {
      ensureKeyDir()
      if (fs.existsSync(HMAC_PATH)) {
        const secret = fs.readFileSync(HMAC_PATH, "utf8")
        return { algo: "HS256", secret }
      }
      const testSecret = process.env.JWT_TEST_HMAC || "test-hmac-secret"
      try {
        fs.writeFileSync(HMAC_PATH, testSecret, { mode: 0o600 })
      } catch (e) {
        warn('[jwt] failed to persist test HS256 secret; proceeding with in-memory test secret', e)
      }
      return { algo: "HS256", secret: testSecret }
    } catch (e) {
      // Fallback to in-memory test secret if anything goes wrong
      warn('[jwt] test key initialization failed; using in-memory test secret', e)
      return { algo: "HS256", secret: process.env.JWT_TEST_HMAC || "test-hmac-secret" }
    }
  }
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
  // If an HMAC secret has been persisted to disk, load it so signed tokens survive restarts.
  if (fs.existsSync(HMAC_PATH)) {
    const secret = fs.readFileSync(HMAC_PATH, "utf8")
    return { algo: "HS256", secret }
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
    error('[jwt] failed to generate RSA keypair, falling back to HS256', err)
    const secret = crypto.randomBytes(32).toString("hex")
    try {
      ensureKeyDir()
      fs.writeFileSync(HMAC_PATH, secret, { mode: 0o600 })
    } catch (e) {
      warn('[jwt] failed to persist HS256 secret to disk; tokens will not survive restarts', e)
    }
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
    // Restrict allowed algorithms explicitly to prevent algorithm confusion attacks.
    return jwt.verify(token, keyinfo.publicKey, { algorithms: ["RS256"] } as jwt.VerifyOptions)
  }
  return jwt.verify(token, keyinfo.secret, { algorithms: ["HS256"] } as jwt.VerifyOptions)
}

export function getKeyInfo() {
  return keyinfo
}
