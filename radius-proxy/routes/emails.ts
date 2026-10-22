
import { verifyToken } from "@/lib/jwt"


// Grafana expects an array of emails objects: [{ email, primary: true }]
// We'll synthesize an email from the username (sub) if not present: <sub>@example.local
export async function GET(req: Request) {
	const auth = req.headers.get('authorization') || ''
	if (!auth.startsWith('Bearer ')) return Response.json({ error: 'invalid_request' }, { status: 401 })
	const token = auth.slice('Bearer '.length)
	try {
		const payload = verifyToken(token) as { [k: string]: unknown }
		const email = typeof payload.email === 'string' ? payload.email : undefined;

		if (!email) {
			return Response.json([], { status: 200 });
		}

		return Response.json([{ email, primary: true }])
	} catch {
		return Response.json({ error: 'invalid_token' }, { status: 401 })
	}
}

