# Deployment

Use one instance with Bun 1.4.3 or the supplied container. Terminate HTTPS at a reverse proxy and keep the backend HTTP listener private. The public origin belongs in `ISSUER`, for example `https://auth.example.com`. Forwarded headers do not override it.

Proxy `/radius_login` and its subpaths without stripping the prefix. Root discovery is also available at `/.well-known/openid-configuration` and `/.well-known/jwks.json`. Existing paths below `/radius_login/api/` remain supported.

Persist `.keys/` with write access for the application user, or provision matching JWT_PRIVATE_KEY and JWT_PUBLIC_KEY environment values. Never copy development or test key directories into images. Keep `config.toml` read-only to the service and supply real secrets. Configure Grafana's callback in `REDIRECT_URIS` exactly.

Before routing users to the service, verify that every RADIUS server sends Message-Authenticator on both Accept and Reject replies. Servers that omit it are rejected and will appear unavailable to health checks. This is required security behaviour; update or reconfigure those servers instead of disabling verification. Restrict RADIUS traffic to the management network or a protected tunnel.

Keep Grafana certificate verification enabled. If it uses an internal CA, configure the CA trust for Bun. `GRAFANA_INSECURE_TLS` is an explicit per-request escape hatch.

Authorization codes and refresh tokens are in memory. Multiple replicas are unsupported without a shared transactional store. A restart invalidates refresh tokens and outstanding codes; access tokens remain valid until expiry if the signing keys are retained.

Use [migration notes](04-migration.md) when upgrading. After switching versions, verify discovery, login with MFA, code exchange, UserInfo, refresh rotation, group/admin mapping, optional team assignment, and failover against your actual services.
