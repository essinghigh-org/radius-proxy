import { NextResponse } from "next/server"
import { signToken } from "@/lib/jwt"
import { config } from "@/lib/config"

export async function POST(req: Request) {
  const body = await req.formData()
  const grant_type = String(body.get("grant_type") || "")

  // Validate client credentials (Basic auth or form fields)
  const authHeader = req.headers.get("authorization") || ""
  let providedClientId = ""
  let providedClientSecret = ""
  if (authHeader.startsWith("Basic ")) {
    try {
      const b = Buffer.from(authHeader.slice(6), "base64").toString("utf8")
      const [cid, secret] = b.split(":", 2)
      providedClientId = cid
      providedClientSecret = secret
    } catch (_) {
      // ignore
    }
  } else {
    providedClientId = String(body.get("client_id") || "")
    providedClientSecret = String(body.get("client_secret") || "")
  }

  const EXPECTED_CLIENT = config.OAUTH_CLIENT_ID || "grafana"
  const EXPECTED_SECRET = config.OAUTH_CLIENT_SECRET || "secret"
  if (providedClientId !== EXPECTED_CLIENT || providedClientSecret !== EXPECTED_SECRET) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 })
  }

  if (grant_type === "authorization_code") {
    const code = String(body.get("code") || "")
    const codes = global._oauth_codes || {}
    const entry = codes[code]
    if (!entry) return NextResponse.json({ error: "invalid_grant" }, { status: 400 })

  const classAttr = entry.class || ""
    const scope = entry.scope || 'openid profile'
    const now = Math.floor(Date.now()/1000)
    let issuer = config.ISSUER
    if (!issuer) {
      try { const u = new URL(req.url); issuer = `${u.protocol}//${u.host}` } catch { /* ignore */ }
    }
    const aud = config.OAUTH_CLIENT_ID
  const email = `${entry.username}@${config.EMAIL_SUFFIX}`
  const groups = Array.isArray(entry.groups) ? entry.groups : ([] as string[])
  const baseClaims = { sub: entry.username, name: entry.username, email, groups }
    const accessToken = signToken({ ...baseClaims, scope, iss: issuer, aud }, { expiresIn: "1h" })
    const idToken = signToken({ ...baseClaims, iss: issuer, aud, iat: now }, { expiresIn: "1h" })

    // once exchanged, remove code
    delete codes[code]

    return NextResponse.json({ access_token: accessToken, token_type: "bearer", expires_in: 3600, id_token: idToken, scope })
  }

  return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 })
}

// Role is no longer derived here; rely purely on groups claim for downstream mapping.
