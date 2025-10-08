import { config } from './config'
import { warn, error, info } from './log'

// Minimal helper to add a user to a Grafana team using service account token.
// Uses teamId (number) and user email. If the user does not exist, Grafana will auto-create
// a pending user when using the admin API /api/admin/users/lookup?loginOrEmail=...

export async function addUserToTeamByEmail(teamId: number, email: string, username?: string, role?: string): Promise<boolean> {
  const token = (config as any).GRAFANA_SA_TOKEN
  if (!token) {
    warn('[grafana] no service account token configured; skipping team assignment')
    return false
  }
  try {
    // Lookup org user by email using current-organization API
    const grafanaBase = (config as any).GRAFANA_BASE_URL || ''
    const lookupUrl = grafanaBase
      ? `${grafanaBase}/api/org/users/lookup?loginOrEmail=${encodeURIComponent(email)}`
      : `/api/org/users/lookup?loginOrEmail=${encodeURIComponent(email)}`
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    info('[grafana] org user lookup', { email, url: lookupUrl })
    const lookupRes = await fetch(lookupUrl, { method: 'GET', headers })
    const lookupText = await lookupRes.text().catch(()=>'<no body>')
    info('[grafana] org lookup response', { email, url: lookupUrl, status: lookupRes.status, body: lookupText })

    if (!lookupRes.ok) {
      // 401/403 likely means the service token doesn't have org-level permissions
      if (lookupRes.status === 401 || lookupRes.status === 403) {
        warn('[grafana] org user lookup unauthorized - service account token may lack org permissions', { email, status: lookupRes.status, body: lookupText })
      } else {
        warn('[grafana] org user lookup failed', { email, status: lookupRes.status, body: lookupText })
      }
      return false
    }

    // Parse lookup response; it may be an array of users or a single object depending on API
    let parsed: any = null
    try {
      parsed = JSON.parse(lookupText)
    } catch {
      warn('[grafana] org lookup returned non-json body', { email, body: lookupText })
      return false
    }

    // Determine the userId property (could be userId or id depending on endpoint)
    let userId: number | null = null
    // If array, try to find exact match by login or email or uid; fallback to none
    if (Array.isArray(parsed) && parsed.length > 0) {
      let found = null
      if (username) {
        found = parsed.find((p: any) => (p.login && p.login.toLowerCase() === username.toLowerCase()) || (p.uid && p.uid.toLowerCase() === username.toLowerCase()))
      }
      if (!found) {
        found = parsed.find((p: any) => (p.email && p.email.toLowerCase() === email.toLowerCase()) || (p.login && p.login.toLowerCase() === email.toLowerCase()))
      }
      if (!found) {
        // no exact match, do not pick the first fuzzy result; we'll try to create the user in org
        found = null
      }
      if (found) userId = Number(found.userId || found.id || found.user_id || found.uid) || null
    } else if (parsed && typeof parsed === 'object') {
      userId = Number(parsed.userId || parsed.id || parsed.user_id || parsed.uid) || null
    }

    // If user not found, do NOT attempt to create org user here.
    // Grafana will create pending users when the login occurs. Instead poll the org lookup
    // a few times with exponential backoff to allow Grafana to create the org user after login.
    if (!userId) {
      const maxRetries = 3
      let attempt = 0
      let backoff = 250 // ms
      while (attempt < maxRetries && !userId) {
        attempt++
        info('[grafana] user not found in org lookup; retrying lookup', { email, attempt, backoff })
        await new Promise((res) => setTimeout(res, backoff))
        backoff *= 2
        // retry lookup
        const retryRes = await fetch(lookupUrl, { method: 'GET', headers })
        const retryText = await retryRes.text().catch(()=>'<no body>')
        info('[grafana] org lookup retry response', { email, url: lookupUrl, attempt, status: retryRes.status, body: retryText })
        if (!retryRes.ok) {
          // if unauthorized on retry, abort early
          if (retryRes.status === 401 || retryRes.status === 403) {
            warn('[grafana] org user lookup unauthorized on retry - service account token may lack org permissions', { email, status: retryRes.status, body: retryText })
            return false
          }
          // otherwise continue retrying
          continue
        }
        try {
          const parsed2 = JSON.parse(retryText)
          if (Array.isArray(parsed2) && parsed2.length > 0) {
            let found = null
            if (username) {
              found = parsed2.find((p: any) => (p.login && p.login.toLowerCase() === username.toLowerCase()) || (p.uid && p.uid.toLowerCase() === username.toLowerCase()))
            }
            if (!found) {
              found = parsed2.find((p: any) => (p.email && p.email.toLowerCase() === email.toLowerCase()) || (p.login && p.login.toLowerCase() === email.toLowerCase()))
            }
            if (found) userId = Number(found.userId || found.id || found.user_id || found.uid) || null
          } else if (parsed2 && typeof parsed2 === 'object') {
            userId = Number(parsed2.userId || parsed2.id || parsed2.user_id || parsed2.uid) || null
          }
        } catch {
          // ignore parse errors and continue retrying
        }
      }
      if (!userId) {
        warn('[grafana] org user still not found after retries; skipping team add', { email })
        return false
      }
    }

    const teamUrl = grafanaBase ? `${grafanaBase}/api/teams/${teamId}/members` : `/api/teams/${teamId}/members`
    info('[grafana] add user to team via POST', { teamId, userId, email, url: teamUrl })
    const addRes = await fetch(teamUrl, { method: 'POST', headers, body: JSON.stringify({ userId }) })
    const addText = await addRes.text().catch(()=>'<no body>')
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
    return true
  } catch (e) {
    error('[grafana] exception', { err: (e as Error).message })
    return false
  }
}

export default { addUserToTeamByEmail }
