import { NextResponse } from "next/server"
import { signToken } from "@/lib/jwt"
import { config } from "@/lib/config"
import { getIssuer } from "@/lib/server-utils"
import { addUserToTeamByEmail } from '@/lib/grafana'
import { getStorage } from '@/lib/storage'
import crypto from "crypto"
import { info, warn } from '@/lib/log'

// Helper to generate tokens from a user entry (from auth code or refresh token)
function generateTokens(
  req: Request,
  user: { username: string; emailDomain?: string; groups?: string[]; scope?: string }
) {
  const scope = user.scope || 'openid profile'
  const now = Math.floor(Date.now() / 1000)
  const issuer = getIssuer(req)
  const aud = config.OAUTH_CLIENT_ID
  const emailDomain = user.emailDomain || config.EMAIL_SUFFIX
  const email = `${user.username}@${emailDomain}`
  const groups: string[] = Array.isArray(user.groups) ? user.groups : []
  const isGrafanaAdmin = groups.some((group: string) => (config.ADMIN_CLASSES || []).includes(group))
  const role = isGrafanaAdmin ? "GrafanaAdmin" : undefined
  const baseClaims = { sub: user.username, name: user.username, email, groups, grafana_admin: isGrafanaAdmin, role }
  const accessToken = signToken({ ...baseClaims, scope, iss: issuer, aud }, { expiresIn: "1h" })
  const idToken = signToken({ ...baseClaims, iss: issuer, aud, iat: now }, { expiresIn: "1h" })
  
  return { accessToken, idToken, scope, email, role, groups }
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

    // Use storage abstraction layer
    const storage = getStorage()
    const entry = await storage.get(code)

    if (!entry || !entry.username) return NextResponse.json({ error: "invalid_grant" }, { status: 400 })

    // Reject expired authorization codes to prevent reuse.
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      // Remove expired code and fail with invalid_grant per spec.
      await storage.delete(code)
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 })
    }

    // PKCE verification (RFC 7636)
    const storedChallenge = entry.code_challenge
    const storedMethod = entry.code_challenge_method || ''
    const code_verifier = String(body.get('code_verifier') || '')

    if (storedChallenge) {
      // If a code_challenge was stored with the code, the client MUST supply code_verifier
      if (!code_verifier) {
        const m = { code }
        warn('[token] PKCE required but code_verifier missing', m)
        return NextResponse.json({ error: 'invalid_grant', error_description: 'code_verifier required' }, { status: 400 })
      }
      // Compare according to method
      if (!storedMethod || storedMethod === 'plain') {
        // plain comparison
        if (code_verifier !== storedChallenge) {
          const m = { code }
          warn('[token] PKCE plain verification failed', m)
          return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
        }
        const mPlain = { code }
        info('[token] PKCE plain verification succeeded', mPlain)
      } else if (storedMethod === 'S256') {
        // compute BASE64URL-ENCODE(SHA256(ASCII(code_verifier))) and compare
        const hash = crypto.createHash('sha256').update(code_verifier, 'ascii').digest()
        const b64 = Buffer.from(hash).toString('base64')
        // convert to base64url without padding
        const b64url = b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
        if (b64url !== storedChallenge) {
          const m = { code }
          warn('[token] PKCE S256 verification failed', m)
          return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
        }
        const mS256 = { code }
        info('[token] PKCE S256 verification succeeded', mS256)
      } else {
        // Unsupported transformation
        const m = { method: storedMethod, code }
        warn('[token] PKCE method unsupported', m)
        return NextResponse.json({ error: 'invalid_request', error_description: 'code_challenge_method not supported' }, { status: 400 })
      }
    }

    const { accessToken, idToken, scope, email, role, groups } = generateTokens(req, entry)

    // Generate refresh token
    const refreshToken = crypto.randomBytes(32).toString("base64url")
    const refreshTokenExpiresAt = Date.now() + (config.OAUTH_REFRESH_TOKEN_TTL * 1000)

    // Store refresh token
    try {
      await storage.setRefreshToken(refreshToken, {
        username: entry.username,
        emailDomain: entry.emailDomain,
        class: entry.class,
        scope: scope,
        groups: groups,
        expiresAt: refreshTokenExpiresAt,
        clientId: providedClientId
      })
    } catch (err) {
      // Log but don't fail - refresh token is optional
      warn('[token] Failed to store refresh token', { error: (err as Error).message })
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
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache'
      }
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

    const { accessToken, idToken, scope, groups } = generateTokens(req, refreshEntry)

    // Optionally rotate refresh token (recommended security practice)
    const newRefreshToken = crypto.randomBytes(32).toString("base64url")
    const newRefreshTokenExpiresAt = Date.now() + (config.OAUTH_REFRESH_TOKEN_TTL * 1000)

    try {
      // Store new refresh token
      await storage.setRefreshToken(newRefreshToken, {
        username: refreshEntry.username,
        emailDomain: refreshEntry.emailDomain,
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
      warn('[token] Failed to rotate refresh token', { error: (err as Error).message })
      return NextResponse.json({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        id_token: idToken,
        refresh_token: refreshToken, // Keep old token if rotation failed
        scope
      }, {
        headers: {
          'Cache-Control': 'no-store',
          'Pragma': 'no-cache'
        }
      })
    }

    return NextResponse.json({
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      id_token: idToken,
      refresh_token: newRefreshToken,
      scope
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache'
      }
    })
  }

  return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 })
}
