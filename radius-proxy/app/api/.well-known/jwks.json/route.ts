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
      // Log the underlying error for diagnostics without exposing details to clients.
      // We prefer the centralized logger, but importing it at module top could create a
      // circular dependency with lib/jwt (which is used above). Do a dynamic import
      // inside the catch so we only load the logger at runtime when needed.
      try {
        const mod = await import('@/lib/log')
        // use structured logging; store message and short error text
        mod.error('[jwks] failed to generate JWK', { err: (err as Error).message })
      } catch {
        // If dynamic import fails for any reason, fall back to a concise console error
        // so the message still appears prominently in developer consoles.
        console.error('[radius-proxy][jwks] failed to generate JWK', (err as Error).message)
      }
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
