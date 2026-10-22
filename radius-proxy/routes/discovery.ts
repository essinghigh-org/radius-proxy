import { getIssuer } from "../lib/server-utils"
import { getKeyInfo } from "../lib/jwt"

import { SUPPORTED_SCOPES } from '@/lib/scopes'

export async function GET(req: Request) {
  const issuer = getIssuer(req)
  const data = {
    issuer,
    authorization_endpoint: `${issuer}/radius_login/api/oauth/authorize`,
    token_endpoint: `${issuer}/radius_login/api/oauth/token`,
    userinfo_endpoint: `${issuer}/radius_login/api/oauth/userinfo`,
    jwks_uri: `${issuer}/radius_login/api/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: [getKeyInfo().algo],
    scopes_supported: Array.from(SUPPORTED_SCOPES.values()),
    claims_supported: ["sub", "name", "email", "role"],
  }
  return Response.json(data, { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Headers": "authorization,content-type,x-grafana-device-id" } })
}

export async function OPTIONS(req: Request) {
  const acrh = req.headers.get('access-control-request-headers') || 'authorization,content-type,x-grafana-device-id'
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": acrh,
    },
  })
}
