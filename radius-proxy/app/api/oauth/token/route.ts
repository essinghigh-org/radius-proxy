import { NextResponse } from "next/server"
import { signToken } from "@/lib/jwt"
import { config } from "@/lib/config"
import { getIssuer } from "@/lib/server-utils"
import { addUserToTeamByEmail } from '@/lib/grafana'
import { getStorage } from '@/lib/storage'
import crypto from "crypto"

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
    
    // Use storage abstraction layer
    const storage = getStorage()
    const entry = await storage.get(code)
    
    if (!entry) return NextResponse.json({ error: "invalid_grant" }, { status: 400 })
    
    // Reject expired authorization codes to prevent reuse.
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      // Remove expired code and fail with invalid_grant per spec.
      await storage.delete(code)
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

    // Generate refresh token
    const refreshToken = crypto.randomBytes(32).toString("base64url")
    const refreshTokenExpiresAt = Date.now() + (config.OAUTH_REFRESH_TOKEN_TTL * 1000)
    
    // Store refresh token
    try {
      await storage.setRefreshToken(refreshToken, {
        username: entry.username,
        class: entry.class,
        scope: scope,
        groups: groups,
        expiresAt: refreshTokenExpiresAt,
        clientId: providedClientId
      })
    } catch (err) {
      // Log but don't fail - refresh token is optional
      console.warn('[token] Failed to store refresh token:', (err as Error).message)
    }

    // Once exchanged, remove code (one-time use)
    try {
      await storage.delete(code)
    } catch {
      // ignore any deletion errors in this demo env
    }

    // After successful token issuance, attempt to add user to any teams mapped from their groups.
    // This is non-blocking and best-effort; failures are logged but do not affect token issuance.
    (async () => {
      try {
        const classMap = (config as Record<string, unknown>).CLASS_MAP as Record<string, number[]> || {}
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
            } catch {
              // Already logged in helper; keep this defensive
            }
          }
        }
      } catch {
        // non-fatal
      }
    })()

    return NextResponse.json({ 
      access_token: accessToken, 
      token_type: "bearer", 
      expires_in: 3600, 
      id_token: idToken, 
      refresh_token: refreshToken,
      scope 
    })
  }

  if (grant_type === "refresh_token") {
    const refreshToken = String(body.get("refresh_token") || "")
    
    if (!refreshToken) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 })
    }

    // Use storage abstraction layer
    const storage = getStorage()
    const refreshEntry = await storage.getRefreshToken(refreshToken)
    
    if (!refreshEntry) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 })
    }
    
    // Check if refresh token is expired
    if (refreshEntry.expiresAt && Date.now() > refreshEntry.expiresAt) {
      // Remove expired refresh token
      await storage.deleteRefreshToken(refreshToken)
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 })
    }

    // Validate client ID matches the one used to create the refresh token
    if (refreshEntry.clientId && refreshEntry.clientId !== providedClientId) {
      return NextResponse.json({ error: "invalid_client" }, { status: 401 })
    }

    const scope = refreshEntry.scope || 'openid profile'
    const now = Math.floor(Date.now()/1000)
    const issuer = getIssuer(req)
    const aud = config.OAUTH_CLIENT_ID
    const email = `${refreshEntry.username}@${config.EMAIL_SUFFIX}`
    const groups: string[] = Array.isArray(refreshEntry.groups) ? refreshEntry.groups : ([] as string[])
    // Check if user should be grafana admin based on configured admin classes
    const isGrafanaAdmin = groups.some((group: string) => (config.ADMIN_CLASSES || []).includes(group))
    const role = isGrafanaAdmin ? "GrafanaAdmin" : undefined
    const baseClaims = { sub: refreshEntry.username, name: refreshEntry.username, email, groups, grafana_admin: isGrafanaAdmin, role }
    
    const accessToken = signToken({ ...baseClaims, scope, iss: issuer, aud }, { expiresIn: "1h" })
    const idToken = signToken({ ...baseClaims, iss: issuer, aud, iat: now }, { expiresIn: "1h" })

    // Optionally rotate refresh token (recommended security practice)
    const newRefreshToken = crypto.randomBytes(32).toString("base64url")
    const newRefreshTokenExpiresAt = Date.now() + (config.OAUTH_REFRESH_TOKEN_TTL * 1000)
    
    try {
      // Store new refresh token
      await storage.setRefreshToken(newRefreshToken, {
        username: refreshEntry.username,
        class: refreshEntry.class,
        scope: scope,
        groups: groups,
        expiresAt: newRefreshTokenExpiresAt,
        clientId: providedClientId
      })
      
      // Remove old refresh token
      await storage.deleteRefreshToken(refreshToken)
    } catch (err) {
      // Log but don't fail - if we can't rotate, return the new tokens with old refresh token
      console.warn('[token] Failed to rotate refresh token:', (err as Error).message)
      return NextResponse.json({ 
        access_token: accessToken, 
        token_type: "bearer", 
        expires_in: 3600, 
        id_token: idToken,
        refresh_token: refreshToken, // Keep old token if rotation failed
        scope 
      })
    }

    return NextResponse.json({ 
      access_token: accessToken, 
      token_type: "bearer", 
      expires_in: 3600, 
      id_token: idToken,
      refresh_token: newRefreshToken,
      scope 
    })
  }

  return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 })
}

// Role is no longer derived here; rely purely on groups claim for downstream mapping.