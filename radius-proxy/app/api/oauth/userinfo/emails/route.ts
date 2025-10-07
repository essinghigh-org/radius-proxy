import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/jwt"
import { config } from "@/lib/config"

// Grafana expects an array of emails objects: [{ email, primary: true }]
// We'll synthesize an email from the username (sub) if not present: <sub>@example.local
export async function GET(req: Request) {
	const auth = req.headers.get('authorization') || ''
	if (!auth.startsWith('Bearer ')) return NextResponse.json({ error: 'invalid_request' }, { status: 401 })
	const token = auth.slice('Bearer '.length)
	try {
		const payload = verifyToken(token) as { [k: string]: unknown }
		const sub = typeof payload.sub === 'string' ? payload.sub : undefined
		if (!sub) return NextResponse.json([], { status: 200 })
		// simple synthetic email; in real world map via directory lookup
		const email = `${sub}@${config.EMAIL_SUFFIX}`
		return NextResponse.json([{ email, primary: true }])
	} catch (_) {
		return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
	}
}

