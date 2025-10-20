import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { radiusHostManager, getActiveRadiusHost, _testReloadHosts, _testInjectHosts } from '@/lib/radius_hosts'
import { _invalidateConfigCache } from '@/lib/config'

// Mock radius module to simulate host responses. We'll return ok for specific hosts.
let responsiveHosts: Set<string>

mock.module('@/lib/radius', () => ({
    radiusAuthenticate: async (
        host: string,
        secret: string,
        username: string,
        password: string,
        timeout?: number,
        port?: number
    ) => {
        // Simulate timeout by never responding if host not responsive
        if (!responsiveHosts.has(host)) {
            // Simulate timeout by throwing error
            throw new Error('timeout')
        }
        return { ok: true }
    }
}))

describe('RadiusHostManager Failover', () => {
    beforeEach(() => {
        _invalidateConfigCache()
        process.env.RADIUS_HOSTS = '10.0.0.1,10.0.0.2,10.0.0.3'
        responsiveHosts = new Set(['10.0.0.1'])
        _testReloadHosts()
    })

    test('initial active host selection chooses first responsive host', async () => {
        const active = getActiveRadiusHost()
        expect(active).toBe('10.0.0.1')
    })

    test('failover activates next responsive host when current fails', async () => {
        // Current active should be 10.0.0.1 (responsive)
        expect(getActiveRadiusHost()).toBe('10.0.0.1')
        // Mark first host down, second up
        responsiveHosts = new Set(['10.0.0.2'])
        await radiusHostManager.failover()
        expect(getActiveRadiusHost()).toBe('10.0.0.2')
    })

    test('clears active host if none responsive', async () => {
        responsiveHosts = new Set()
        await radiusHostManager.failover()
        // When none responsive, active host cleared; getter returns first configured host
        expect(getActiveRadiusHost()).toBe('10.0.0.1')
    })
})
