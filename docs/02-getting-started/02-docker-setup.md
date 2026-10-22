# Docker setup

From the repository root, copy `radius-proxy/config.example.toml` to `config.toml` and edit all deployment values. See [installation](01-installation.md) for required settings.

```sh
docker compose build
docker compose up -d
```

The provided Compose file binds HTTP to `127.0.0.1:54567` for a local TLS reverse proxy, mounts the configuration read-only, and persists signing keys in a named volume. The image runs as the unprivileged `bun` user with dropped capabilities. The volume must remain writable by that user.

If the reverse proxy runs in another container, connect both services to a private Docker network and route to `radius-proxy:54567`. Adjust networking for that deployment; do not expose the backend publicly without TLS.

The Docker build installs from the committed Bun lockfile, checks types, and bundles the Elysia server. The runtime image installs production dependencies only and contains no example configuration or development signing keys.

RADIUS servers must send Message-Authenticator on both Access-Accept and Access-Reject. Verify this before switching traffic to the new version.
