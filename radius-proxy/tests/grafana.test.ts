import { expect, spyOn, test } from 'bun:test'
import { addUserToTeamByEmail } from '../lib/grafana'
import { _invalidateConfigCache } from '../lib/config'

for (const insecure of [false, true]) {
  test(`Grafana TLS override is request-scoped (insecure=${insecure})`, async () => {
    const saved = { GRAFANA_INSECURE_TLS: process.env.GRAFANA_INSECURE_TLS, GRAFANA_SA_TOKEN: process.env.GRAFANA_SA_TOKEN, GRAFANA_BASE_URL: process.env.GRAFANA_BASE_URL }
    const originalGlobalTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.GRAFANA_INSECURE_TLS = String(insecure)
    process.env.GRAFANA_SA_TOKEN = 'test-only-service-account'
    process.env.GRAFANA_BASE_URL = 'https://grafana.example.com'
    _invalidateConfigCache()
    let requests = 0
    const mocked = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
      requests++
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(originalGlobalTLS)
      expect(options?.redirect).toBe('error')
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      expect((options as RequestInit & { tls?: { rejectUnauthorized?: boolean } }).tls?.rejectUnauthorized).toBe(!insecure)
      if (String(input).includes('/lookup?')) return Response.json({ id: 101, login: 'alice', email: 'alice@example.local' })
      if (options?.method === 'POST') return Response.json({})
      return Response.json([])
    }, { preconnect: fetch.preconnect }))
    try {
      expect(await addUserToTeamByEmail(insecure ? 201 : 202, 'alice@example.local', 'alice')).toBe(true)
      expect(requests).toBe(3)
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(originalGlobalTLS)
    } finally {
      mocked.mockRestore()
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      _invalidateConfigCache()
    }
  })
}
