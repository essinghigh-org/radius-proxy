import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/jwt"

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || ""
  if (!auth.startsWith("Bearer ")) return NextResponse.json({ error: "invalid_request" }, { status: 401 })
  const token = auth.slice("Bearer ".length)
  try {
    const payload = verifyToken(token) as Record<string, unknown>
    const sub = typeof payload.sub === "string" ? payload.sub : undefined
    const groups = Array.isArray(payload.groups)
      ? (payload.groups as unknown[]).filter((g): g is string => typeof g === "string")
      : undefined
    return NextResponse.json({ sub, name: sub, groups })
  } catch {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 })
  }
}
