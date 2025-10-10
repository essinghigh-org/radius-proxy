import { config, _invalidateConfigCache } from '../../lib/config'

describe('Grafana TLS Configuration', () => {
  beforeEach(() => {
    _invalidateConfigCache()
  })

  afterEach(() => {
    // Clean up any env vars we set
    delete process.env.GRAFANA_INSECURE_TLS
    _invalidateConfigCache()
  })

  describe('GRAFANA_INSECURE_TLS Configuration', () => {
    it('should default to false when not specified', () => {
      expect(config.GRAFANA_INSECURE_TLS).toBe(false)
    })

    it('should parse true from environment variable', () => {
      process.env.GRAFANA_INSECURE_TLS = 'true'
      _invalidateConfigCache()
      expect(config.GRAFANA_INSECURE_TLS).toBe(true)
    })

    it('should parse false from environment variable', () => {
      process.env.GRAFANA_INSECURE_TLS = 'false'
      _invalidateConfigCache()
      expect(config.GRAFANA_INSECURE_TLS).toBe(false)
    })

    it('should handle case-insensitive boolean values', () => {
      process.env.GRAFANA_INSECURE_TLS = 'TRUE'
      _invalidateConfigCache()
      expect(config.GRAFANA_INSECURE_TLS).toBe(true)

      process.env.GRAFANA_INSECURE_TLS = 'False'
      _invalidateConfigCache()
      expect(config.GRAFANA_INSECURE_TLS).toBe(false)
    })

    it('should default to false for invalid values', () => {
      process.env.GRAFANA_INSECURE_TLS = 'invalid'
      _invalidateConfigCache()
      expect(config.GRAFANA_INSECURE_TLS).toBe(false)

      process.env.GRAFANA_INSECURE_TLS = '1'
      _invalidateConfigCache()
      expect(config.GRAFANA_INSECURE_TLS).toBe(false)
    })
  })
})