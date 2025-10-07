import { NextResponse } from "next/server"
import { config } from "@/lib/config"

export async function GET(req: Request) {
  // Respect reverse proxy headers when deriving the public issuer so discovery and tokens
  // point at the canonical external HTTPS URL (nginx should set X-Forwarded-Proto and X-Forwarded-Host).
  const xfProto = req.headers.get("x-forwarded-proto")
  const xfHost = req.headers.get("x-forwarded-host")
  const proto = xfProto || "http"
  // Prefer explicit HTTP_HOST config (replaces HOSTNAME). Keep compatibility via config loader.
  const host = xfHost || req.headers.get("host") || config.HTTP_HOST
  const base = config.ISSUER || `${proto}://${host}`
  const issuer = config.ISSUER || base
  const data = {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    userinfo_endpoint: `${issuer}/api/oauth/userinfo`,
    jwks_uri: `${issuer}/api/.well-known/jwks.json`,
    // advertise configuration values so operators can verify runtime config matches expected
    op_config: {
      http_host: config.HTTP_HOST,
      http_port: config.HTTP_PORT,
      issuer_from_config: !!config.ISSUER,
    },
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"],
    claims_supported: ["sub", "name", "email", "role"],
  }
  return NextResponse.json(data, { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Headers": "authorization,content-type,x-grafana-device-id" } })
}

export async function OPTIONS(req: Request) {
  const acrh = req.headers.get('access-control-request-headers') || 'authorization,content-type,x-grafana-device-id'
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": acrh,
    },
  })
}
