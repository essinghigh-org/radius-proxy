# Grafana OAuth2 to RADIUS login

A small OAuth/OIDC bridge that authenticates Grafana users against RADIUS. Runs on **Bun 1.4.3 + Elysia**, with a server-rendered login form and no frontend framework.

```sh
cd radius-proxy
bun install --frozen-lockfile --ignore-scripts
cp config.example.toml config.toml
# Configure secrets, ISSUER, RADIUS servers and Grafana's exact callback URI.
bun run dev
```

The login page is `/radius_login`. Existing `/radius_login/api/oauth/*` URLs are preserved. See the [documentation](docs/README.md) and [migration notes](docs/06-guides/04-migration.md) before upgrading an existing deployment.

```sh
bun run typecheck
bun run lint
bun run test
bun audit
bun run build
```

OAuth codes and refresh tokens are held in memory: use one instance. Persist `.keys/` to retain signing keys across restarts. RADIUS servers must include Message-Authenticator in every response.
