import { config } from './config'
import { warn, error, info } from './log'
import https from 'https'

// Types describing Grafana REST API shapes we touch in this helper.
interface GrafanaOrgUserLookupItem {
  id?: number
  userId?: number
  user_id?: number
  uid?: string
  login?: string
  email?: string
}

interface GrafanaTeamMemberItem {
  id?: number
  userId?: number
  user_id?: number
}

// Augment global for module-level caches (avoid re-adding properties repeatedly)
// We purposefully keep these small and ephemeral (TTL + cleanup) so no memory leak risk.
interface GrafanaGlobalCache {
  __grafana_inflight?: Map<string, Promise<boolean>>
  __grafana_done?: Map<string, number>
}

declare const global: typeof globalThis & GrafanaGlobalCache

// Get fetch options with optional TLS configuration
function getFetchOptions(headers: Record<string, string>, method: string, body?: string): RequestInit {
  const options: RequestInit = { method, headers }
  if (body) options.body = body
  
  // If TLS verification is disabled, create an HTTPS agent that ignores certificate errors
  if (config.GRAFANA_INSECURE_TLS) {
    const agent = new https.Agent({
      rejectUnauthorized: false
    })
    // @ts-expect-error - Node.js specific fetch option
    options.agent = agent
  }
  
  return options
}

// Add a user to a Grafana team using a service account token.
// Uses teamId and user email. If the user isn't present in the org yet,
// the helper polls the org lookup endpoint a few times to wait for the
// user to appear (Grafana may create a pending org user on first login).
export async function addUserToTeamByEmail(teamId: number, email: string, username?: string, role?: string): Promise<boolean> {
  const key = `${teamId}:${email}`

  // initialize module-level caches lazily
  if (!global.__grafana_inflight) global.__grafana_inflight = new Map<string, Promise<boolean>>()
  if (!global.__grafana_done) global.__grafana_done = new Map<string, number>()
  const inflight = global.__grafana_inflight
  const done = global.__grafana_done

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
  const token = config.GRAFANA_SA_TOKEN
      if (!token) {
        warn('[grafana] no service account token configured; skipping team assignment')
        return false
      }

  const grafanaBase = config.GRAFANA_BASE_URL || ''
      const lookupUrl = grafanaBase
        ? `${grafanaBase}/api/org/users/lookup?loginOrEmail=${encodeURIComponent(email)}`
        : `/api/org/users/lookup?loginOrEmail=${encodeURIComponent(email)}`
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

      info('[grafana] org user lookup', { email, url: lookupUrl })
      const lookupRes = await fetch(lookupUrl, getFetchOptions(headers, 'GET'))
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

  let parsed: unknown = null
  try { parsed = JSON.parse(lookupText) } catch { warn('[grafana] org lookup returned non-json body', { email, body: lookupText }); return false }

      const findUserInArray = (arr: GrafanaOrgUserLookupItem[]): number | null => {
        let found: GrafanaOrgUserLookupItem | undefined
        if (username) {
          const uname = username.toLowerCase()
          found = arr.find(p => (p.login && p.login.toLowerCase() === uname) || (p.uid && p.uid.toLowerCase() === uname))
        }
        if (!found) {
          const emLower = email.toLowerCase()
            ; (found = arr.find(p => (p.email && p.email.toLowerCase() === emLower) || (p.login && p.login.toLowerCase() === emLower)))
        }
        if (found) return Number(found.userId || found.id || found.user_id || found.uid) || null
        return null
      }

      let userId: number | null = null
      if (Array.isArray(parsed) && parsed.length > 0) {
        userId = findUserInArray(parsed as GrafanaOrgUserLookupItem[])
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as GrafanaOrgUserLookupItem
        userId = Number(obj.userId || obj.id || obj.user_id || obj.uid) || null
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
          const retryRes = await fetch(lookupUrl, getFetchOptions(headers, 'GET'))
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
              userId = findUserInArray(parsed2 as GrafanaOrgUserLookupItem[])
            } else if (parsed2 && typeof parsed2 === 'object') {
              const obj2 = parsed2 as GrafanaOrgUserLookupItem
              userId = Number(obj2.userId || obj2.id || obj2.user_id || obj2.uid) || null
            }
          } catch {}
        }
        if (!userId) { warn('[grafana] org user still not found after retries; skipping team add', { email }); return false }
      }

      const teamUrl = grafanaBase ? `${grafanaBase}/api/teams/${teamId}/members` : `/api/teams/${teamId}/members`
      // Check current team members to avoid duplicate adds (idempotent)
      try {
        const membersRes = await fetch(teamUrl, getFetchOptions(headers, 'GET'))
        const membersText = await membersRes.text().catch(() => '<no body>')
        if (membersRes.ok) {
          try {
            const members: unknown = JSON.parse(membersText)
            if (Array.isArray(members) && members.find((m: GrafanaTeamMemberItem) => Number(m.userId || m.id || m.user_id) === Number(userId))) {
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
      const addRes = await fetch(teamUrl, getFetchOptions(headers, 'POST', JSON.stringify({ userId, role })))
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

const grafanaHelpers = { addUserToTeamByEmail }
export default grafanaHelpers
