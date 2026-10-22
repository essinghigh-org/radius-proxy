
import fs from "fs"
import path from "path"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { config } from "./config"
import { getIssuer } from "./server-utils"
import { findProjectRoot } from "./server-utils"

type RSKeyInfo = { algo: "RS256"; privateKey: string; publicKey: string; kid: string }
type HSKeyInfo = { algo: "HS256"; secret: string }
type KeyInfo = RSKeyInfo | HSKeyInfo

const KEY_DIR = path.resolve(findProjectRoot(), ".keys")
const HMAC_PATH = path.join(KEY_DIR, "jwt.hmac")

function ensureKeyDir() {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 })
}

function loadOrCreateKeys(): KeyInfo {
  // Prefer environment-supplied PEM keys
  const privEnv = process.env.JWT_PRIVATE_KEY || ""
  const pubEnv = process.env.JWT_PUBLIC_KEY || ""
  const hmacEnv = process.env.JWT_HS256_SECRET || ""
  // If an HS256 secret is explicitly provided via env, prefer it
  if (hmacEnv) {
    if (Buffer.byteLength(hmacEnv) < 32) throw new Error("JWT_HS256_SECRET must contain at least 32 bytes")
    return { algo: "HS256", secret: hmacEnv }
  }
  // Tests never write signing material into a deployment's key directory.
  if (process.env.NODE_ENV === "test") return { algo: "HS256", secret: crypto.randomBytes(32).toString("hex") }
  if (!!privEnv !== !!pubEnv) throw new Error("Provide both JWT_PRIVATE_KEY and JWT_PUBLIC_KEY")
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
  if (fs.existsSync(HMAC_PATH)) throw new Error("Remove legacy jwt.hmac and provision secure signing keys")

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
    throw new Error("Cannot persist RSA signing keys", { cause: err })
  }
}

const keyinfo: KeyInfo = loadOrCreateKeys()

export function signToken(payload: object, opts?: jwt.SignOptions): string {
  if (keyinfo.algo === "RS256") {
    // jsonwebtoken library expects kid via keyid option; it adds header.kid automatically
    return jwt.sign(payload, keyinfo.privateKey, { algorithm: "RS256", keyid: keyinfo.kid, ...(opts || {}) })
  }
  return jwt.sign(payload, keyinfo.secret, { algorithm: "HS256", ...(opts || {}) })
}

export function verifyToken(token: string): jwt.JwtPayload {
  const payload = jwt.verify(token, keyinfo.algo === "RS256" ? keyinfo.publicKey : keyinfo.secret, {
    algorithms: [keyinfo.algo], issuer: getIssuer(), audience: config.OAUTH_CLIENT_ID,
  })
  if (typeof payload === "string" || !payload.sub || !payload.exp || payload.token_use !== "access") throw new Error("Invalid access token")
  return payload
}

export function getKeyInfo(): KeyInfo {
  return keyinfo
}
