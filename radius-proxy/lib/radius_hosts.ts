import { config } from './config'
import { debug, info, warn } from './log'
import { radiusAuthenticate as radiusAuthHost } from './radius'

interface HostHealth {
    host: string
    lastOkAt: number | null
    lastTriedAt: number | null
    consecutiveFailures: number
}

class RadiusHostManager {
    private hosts: string[] = []
    private health: Map<string, HostHealth> = new Map()
    private activeHost: string | null = null
    private inProgress: boolean = false
    private intervalHandle: NodeJS.Timeout | null = null

    constructor() {
        this.reloadHostsFromConfig()
        this.selectInitialActive()
        this.scheduleHealthChecks()
    }

    private reloadHostsFromConfig() {
        const list = Array.isArray(config.RADIUS_HOSTS) ? config.RADIUS_HOSTS : [config.RADIUS_HOST].filter(Boolean)
        this.hosts = list.filter(Boolean)
        for (const h of this.hosts) {
            if (!this.health.has(h)) {
                this.health.set(h, { host: h, lastOkAt: null, lastTriedAt: null, consecutiveFailures: 0 })
            }
        }
    }

    private selectInitialActive() {
        if (!this.activeHost && this.hosts.length) {
            // Try hosts in priority order until one responds (fast probe sequence)
            this.fastFailoverSequence().catch(e => warn('[radius-hosts] initial sequence error', e))
        }
    }

    getActiveHost(): string {
        if (this.activeHost) return this.activeHost
        // Fallback: first host while we have not yet validated any
        return this.hosts[0] || config.RADIUS_HOST
    }

    async fastFailoverSequence(): Promise<string | null> {
        if (this.inProgress) return this.activeHost
        this.inProgress = true
        try {
            for (const host of this.hosts) {
                const ok = await this.probeHost(host)
                if (ok) {
                    this.setActiveHost(host, 'initial')
                    return host
                }
            }
            warn('[radius-hosts] No RADIUS hosts responded during initial probe')
            return null
        } finally {
            this.inProgress = false
        }
    }

    private setActiveHost(host: string, reason: string) {
        if (this.activeHost === host) return
        const prev = this.activeHost
        this.activeHost = host
        info('[radius-hosts] active host updated', { host, prev, reason })
    }

    private scheduleHealthChecks() {
        const intervalSec = Number(config.RADIUS_HEALTHCHECK_INTERVAL || 1800)
        if (this.intervalHandle) clearInterval(this.intervalHandle)
        this.intervalHandle = setInterval(() => {
            this.backgroundHealthCycle().catch(e => warn('[radius-hosts] background health cycle error', e))
        }, Math.max(5, intervalSec) * 1000)
    }

    async backgroundHealthCycle() {
        // If we have an active host, probe it; if it's down trigger failover attempts immediately.
        if (this.activeHost) {
            const ok = await this.probeHost(this.activeHost)
            if (!ok) {
                warn('[radius-hosts] active host failed health check, starting failover sequence', { host: this.activeHost })
                await this.failover()
            }
            return
        }
        // No active host yet: cycle through hosts once
        for (const host of this.hosts) {
            const ok = await this.probeHost(host)
            if (ok) {
                this.setActiveHost(host, 'healthcycle')
                break
            }
        }
    }

    async failover(): Promise<string | null> {
        // Try next hosts in order starting after current active
        const startIndex = this.activeHost ? this.hosts.indexOf(this.activeHost) + 1 : 0
        const ordered = [...this.hosts.slice(startIndex), ...this.hosts.slice(0, startIndex)]
        for (const host of ordered) {
            if (host === this.activeHost) continue
            const ok = await this.probeHost(host)
            if (ok) {
                this.setActiveHost(host, 'failover')
                return host
            }
        }
        // None responded; clear active host so next cycle re-attempts from first
        warn('[radius-hosts] failover sequence found no responsive hosts')
        this.activeHost = null
        return null
    }

    async probeHost(host: string): Promise<boolean> {
        const hcUser = config.RADIUS_HEALTHCHECK_USER || 'grafana_dummy_user'
        const hcPass = config.RADIUS_HEALTHCHECK_PASSWORD || 'dummy_password'
        const timeoutSec = Number(config.RADIUS_HEALTHCHECK_TIMEOUT || 5)
        const timeoutMs = Math.max(0, timeoutSec) * 1000
        const entry = this.health.get(host)!
        entry.lastTriedAt = Date.now()
        try {
            debug('[radius-hosts] probing host', { host })
            const port = Number(config.RADIUS_PORT || 1812)
            const res = await radiusAuthHost(host, config.RADIUS_SECRET, hcUser, hcPass, timeoutMs, port)
            if (res.ok) {
                entry.lastOkAt = Date.now()
                entry.consecutiveFailures = 0
                debug('[radius-hosts] probe success', { host })
                return true
            }
            entry.consecutiveFailures++
            debug('[radius-hosts] probe negative response', { host })
            return true // Any response (accept/reject) counts as alive per requirements
        } catch (e) {
            entry.consecutiveFailures++
            debug('[radius-hosts] probe exception', { host, error: (e as Error).message })
            return false
        }
    }

    // Called when an authentication attempt times out to opportunistically verify active host
    async onAuthTimeout() {
        warn('[radius-hosts] auth timeout detected; probing active host')
        if (this.activeHost) {
            const alive = await this.probeHost(this.activeHost)
            if (!alive) await this.failover()
        } else {
            await this.backgroundHealthCycle()
        }
    }
}

// Singleton instance exported
export const radiusHostManager = new RadiusHostManager()

export function getActiveRadiusHost(): string {
    return radiusHostManager.getActiveHost()
}

export async function notifyAuthTimeout() {
    await radiusHostManager.onAuthTimeout()
}

// TEST UTILITIES (not part of public production API)
// Allows tests to inject custom host lists after setting env vars & invalidating config.
export function _testReloadHosts(): void {
    radiusHostManager['reloadHostsFromConfig']()
    radiusHostManager['activeHost'] = null
    radiusHostManager['selectInitialActive']()
}

export function _testInjectHosts(hosts: string[]): void {
    // Replace host list entirely for deterministic testing
    radiusHostManager['hosts'] = hosts.slice()
    radiusHostManager['health'] = new Map(hosts.map(h => [h, { host: h, lastOkAt: null, lastTriedAt: null, consecutiveFailures: 0 }]))
    radiusHostManager['activeHost'] = null
    radiusHostManager['fastFailoverSequence']().catch(e => warn('[radius-hosts][test] fast sequence error', e))
}
