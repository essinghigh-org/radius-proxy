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
		const emailFromToken = typeof payload.email === 'string' ? payload.email : undefined;
		const sub = typeof payload.sub === 'string' ? payload.sub : undefined

		if (!emailFromToken && !sub) {
			return NextResponse.json([], { status: 200 });
		}

		// Prefer the email from the token, but fall back to synthesizing it from the subject
		// and configured suffix for backward compatibility or other use cases.
		const email = emailFromToken || `${sub}@${config.EMAIL_SUFFIX}`;

		return NextResponse.json([{ email, primary: true }])
	} catch {
		return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
	}
}

