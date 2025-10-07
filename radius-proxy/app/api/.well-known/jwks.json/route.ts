import { NextResponse } from "next/server"
import { getKeyInfo } from "@/lib/jwt"
import crypto from "crypto"

export async function GET() {
  const keyinfo = getKeyInfo()
  if (keyinfo.algo === 'RS256') {
    const pub = keyinfo.publicKey
    try {
      const key = crypto.createPublicKey(pub)
      const jwk = key.export({ format: 'jwk' }) as Record<string, unknown>
      const kid = crypto.createHash('sha256').update(pub).digest('base64url')
      ;(jwk as Record<string, unknown>)['kid'] = kid
      ;(jwk as Record<string, unknown>)['use'] = 'sig'
      return NextResponse.json(
        { keys: [jwk] },
        { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type,x-grafana-device-id" } }
      )
    } catch (err) {
      // Log the underlying error for diagnostics without exposing details to clients
      console.error('[jwks] failed to generate JWK', err)
      return NextResponse.json(
        { keys: [] },
        { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type,x-grafana-device-id" } }
      )
    }
  }
  return NextResponse.json(
    { keys: [] },
    { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type,x-grafana-device-id" } }
  )
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
