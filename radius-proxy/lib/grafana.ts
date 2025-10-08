import { config } from './config'
import { warn, error, info } from './log'

// Add a user to a Grafana team using a service account token.
// Uses teamId and user email. If the user isn't present in the org yet,
// the helper polls the org lookup endpoint a few times to wait for the
// user to appear (Grafana may create a pending org user on first login).
export async function addUserToTeamByEmail(teamId: number, email: string, username?: string, role?: string): Promise<boolean> {
  const key = `${teamId}:${email}`

  // initialize module-level caches lazily
  if (!(global as any).__grafana_inflight) (global as any).__grafana_inflight = new Map<string, Promise<boolean>>()
  if (!(global as any).__grafana_done) (global as any).__grafana_done = new Map<string, number>()
  const inflight: Map<string, Promise<boolean>> = (global as any).__grafana_inflight
  const done: Map<string, number> = (global as any).__grafana_done

  const DONE_TTL = 60 * 1000 // 60s cache for completed adds
  const prev = done.get(key)
  if (prev && (Date.now() - prev) < DONE_TTL) {
    info('[grafana] skipping duplicate team add (recently completed)', { teamId, email })
    return true
  }

  const existing = inflight.get(key)
  if (existing) return existing

  const promise = (async (): Promise<boolean> => {
    try {
      const token = (config as any).GRAFANA_SA_TOKEN
      if (!token) {
        warn('[grafana] no service account token configured; skipping team assignment')
        return false
      }

      const grafanaBase = (config as any).GRAFANA_BASE_URL || ''
      const lookupUrl = grafanaBase
        ? `${grafanaBase}/api/org/users/lookup?loginOrEmail=${encodeURIComponent(email)}`
        : `/api/org/users/lookup?loginOrEmail=${encodeURIComponent(email)}`
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

      info('[grafana] org user lookup', { email, url: lookupUrl })
      const lookupRes = await fetch(lookupUrl, { method: 'GET', headers })
      const lookupText = await lookupRes.text().catch(() => '<no body>')
      info('[grafana] org lookup response', { email, url: lookupUrl, status: lookupRes.status, body: lookupText })

      if (!lookupRes.ok) {
        if (lookupRes.status === 401 || lookupRes.status === 403) {
          warn('[grafana] org user lookup unauthorized - service account token may lack org permissions', { email, status: lookupRes.status, body: lookupText })
        } else {
          warn('[grafana] org user lookup failed', { email, status: lookupRes.status, body: lookupText })
        }
        return false
      }

      let parsed: any = null
      try { parsed = JSON.parse(lookupText) } catch { warn('[grafana] org lookup returned non-json body', { email, body: lookupText }); return false }

      const findUserInArray = (arr: any[]): number | null => {
        let found: any = null
        if (username) found = arr.find((p: any) => (p.login && p.login.toLowerCase() === username.toLowerCase()) || (p.uid && p.uid.toLowerCase() === username.toLowerCase()))
        if (!found) found = arr.find((p: any) => (p.email && p.email.toLowerCase() === email.toLowerCase()) || (p.login && p.login.toLowerCase() === email.toLowerCase()))
        if (found) return Number(found.userId || found.id || found.user_id || found.uid) || null
        return null
      }

      let userId: number | null = null
      if (Array.isArray(parsed) && parsed.length > 0) {
        userId = findUserInArray(parsed)
      } else if (parsed && typeof parsed === 'object') {
        userId = Number(parsed.userId || parsed.id || parsed.user_id || parsed.uid) || null
      }

      // If user not found, poll a few times with exponential backoff
      if (!userId) {
        let attempt = 0
        let backoff = 250
        const maxRetries = 3
        while (attempt < maxRetries && !userId) {
          attempt++
          info('[grafana] user not found in org lookup; retrying lookup', { email, attempt, backoff })
          await new Promise((res) => setTimeout(res, backoff))
          backoff *= 2
          const retryRes = await fetch(lookupUrl, { method: 'GET', headers })
          const retryText = await retryRes.text().catch(() => '<no body>')
          info('[grafana] org lookup retry response', { email, url: lookupUrl, attempt, status: retryRes.status, body: retryText })
          if (!retryRes.ok) {
            if (retryRes.status === 401 || retryRes.status === 403) {
              warn('[grafana] org user lookup unauthorized on retry - service account token may lack org permissions', { email, status: retryRes.status, body: retryText })
              return false
            }
            continue
          }
          try {
            const parsed2 = JSON.parse(retryText)
            if (Array.isArray(parsed2) && parsed2.length > 0) {
              userId = findUserInArray(parsed2)
            } else if (parsed2 && typeof parsed2 === 'object') {
              userId = Number(parsed2.userId || parsed2.id || parsed2.user_id || parsed2.uid) || null
            }
          } catch {}
        }
        if (!userId) { warn('[grafana] org user still not found after retries; skipping team add', { email }); return false }
      }

      const teamUrl = grafanaBase ? `${grafanaBase}/api/teams/${teamId}/members` : `/api/teams/${teamId}/members`
      // Check current team members to avoid duplicate adds (idempotent)
      try {
        const membersRes = await fetch(teamUrl, { method: 'GET', headers })
        const membersText = await membersRes.text().catch(() => '<no body>')
        if (membersRes.ok) {
          try {
            const members = JSON.parse(membersText)
            if (Array.isArray(members) && members.find((m: any) => Number(m.userId || m.id || m.user_id) === Number(userId))) {
              info('[grafana] user already a member of team; skipping add', { teamId, userId, email })
              done.set(key, Date.now())
              setTimeout(() => { try { done.delete(key) } catch {} }, DONE_TTL)
              return true
            }
          } catch {
            // ignore parse errors and fallback to attempting add
          }
        }
      } catch {
        // ignore network errors here and proceed to POST
      }

      info('[grafana] add user to team via POST', { teamId, userId, email, url: teamUrl })
      const addRes = await fetch(teamUrl, { method: 'POST', headers, body: JSON.stringify({ userId, role }) })
      const addText = await addRes.text().catch(() => '<no body>')
      info('[grafana] add response', { teamId, userId, status: addRes.status, body: addText })
      if (!addRes.ok) {
        if (addRes.status === 401 || addRes.status === 403) {
          warn('[grafana] add user to team unauthorized - service account token may lack team write permissions', { teamId, userId, status: addRes.status, body: addText })
        } else {
          warn('[grafana] add user to team failed', { teamId, userId, status: addRes.status, body: addText })
        }
        return false
      }

      info('[grafana] added user to team', { teamId, userId, email, body: addText })
      done.set(key, Date.now())
      setTimeout(() => { try { done.delete(key) } catch {} }, DONE_TTL)
      return true
    } catch (e) {
      error('[grafana] exception', { err: (e as Error).message })
      return false
    }
  })()

  inflight.set(key, promise)
  promise.finally(() => { try { inflight.delete(key) } catch {} })
  return promise
}

export default { addUserToTeamByEmail }
