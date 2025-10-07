import { NextResponse } from "next/server"
import { config } from "@/lib/config"

export async function GET(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "http"
  const host = req.headers.get("host") || config.HOSTNAME
  const base = config.ISSUER || `${proto}://${host}`
  const issuer = config.ISSUER || base
  const data = {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    userinfo_endpoint: `${issuer}/api/oauth/userinfo`,
    jwks_uri: `${issuer}/api/.well-known/jwks.json`,
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
