import { NextResponse } from "next/server"
import { signToken } from "@/lib/jwt"
import { config } from "@/lib/config"
import { getIssuer } from "@/lib/server-utils"
import { addUserToTeamByEmail } from '@/lib/grafana'

declare global {
  // pointer for simple in-memory code store (same shape as used by authorize)
  // Each entry may include an optional expiresAt timestamp (ms since epoch).
  var _oauth_codes: Record<string, { username: string; class?: string; scope?: string; groups?: string[]; expiresAt?: number }>
}

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
    } catch {
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
    // Ensure the global code store exists and we operate on the same object across modules
  ;(global as any)._oauth_codes = (global as any)._oauth_codes || {}
  const codes = (global as any)._oauth_codes
  const entry = codes[code]
    if (!entry) return NextResponse.json({ error: "invalid_grant" }, { status: 400 })
    // Reject expired authorization codes to prevent reuse.
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
  // Remove expired code and fail with invalid_grant per spec.
    delete (codes as any)[code]
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 })
    }

    const scope = entry.scope || 'openid profile'
    const now = Math.floor(Date.now()/1000)
    const issuer = getIssuer(req)
    const aud = config.OAUTH_CLIENT_ID
  const email = `${entry.username}@${config.EMAIL_SUFFIX}`
  const groups: string[] = Array.isArray(entry.groups) ? entry.groups : ([] as string[])
  // Check if user should be grafana admin based on configured admin classes
  const isGrafanaAdmin = groups.some((group: string) => (config.ADMIN_CLASSES || []).includes(group))
  const role = isGrafanaAdmin ? "GrafanaAdmin" : undefined
  const baseClaims = { sub: entry.username, name: entry.username, email, groups, grafana_admin: isGrafanaAdmin, role }
    const accessToken = signToken({ ...baseClaims, scope, iss: issuer, aud }, { expiresIn: "1h" })
    const idToken = signToken({ ...baseClaims, iss: issuer, aud, iat: now }, { expiresIn: "1h" })

  // once exchanged, remove code (demo store): delete the entry so lookups fail and cleanup removes expired entries
  try {
    delete (codes as any)[code]
  } catch {
    // ignore any deletion errors in this demo env
  }

    // After successful token issuance, attempt to add user to any teams mapped from their groups.
    // This is non-blocking and best-effort; failures are logged but do not affect token issuance.
    (async () => {
      try {
        const classMap = (config as any).CLASS_MAP || {}
        const email = `${entry.username}@${config.EMAIL_SUFFIX}`
        const groups = Array.isArray(entry.groups) ? entry.groups : ([] as string[])
        const role = baseClaims.role
        // Deduplicate team IDs across groups to avoid calling the helper multiple times for the same team.
        const seen = new Set<number>()
        for (const g of groups) {
          const teamIds: number[] = classMap[g] || []
          for (const tid of teamIds) {
            if (seen.has(tid)) continue
            seen.add(tid)
            try {
              await addUserToTeamByEmail(tid, email, entry.username, role)
            } catch (e) {
              // Already logged in helper; keep this defensive
            }
          }
        }
      } catch (e) {
        // non-fatal
      }
    })()

    return NextResponse.json({ access_token: accessToken, token_type: "bearer", expires_in: 3600, id_token: idToken, scope })
  }

  return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 })
}

// Role is no longer derived here; rely purely on groups claim for downstream mapping.