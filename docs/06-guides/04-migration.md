# Migration to Bun and Elysia

The server now runs on Bun 1.4.3 and Elysia. Next.js, React, Tailwind and their UI dependencies have been removed. The login page and existing `/radius_login/api/` routes are preserved. `/api/` aliases and standard root discovery URLs are also available.

## Before upgrading

1. Back up `config.toml` and the signing-key directory. Keep the previous image available for rollback.
2. Set a randomly generated OAuth client secret of at least 32 characters in both the proxy and Grafana. Set the actual RADIUS shared secret. Shipped example secrets no longer work.
3. Set an explicit public HTTPS `ISSUER` with no trailing slash, and list Grafana's exact callback URI in `REDIRECT_URIS`. Host and forwarded headers are ignored for issuer selection. HTTP is allowed only for loopback development.
4. Configure or update all RADIUS servers to include Message-Authenticator in Accept and Reject replies. Missing or invalid authenticators now cause the response to be dropped, including for health-check probes.
5. Check `EMAIL_SUFFIX` against Grafana user records. Domains supplied in login usernames no longer control the email claim or team lookup.
6. Configure Grafana to send `redirect_uri` during code exchange. Codes now require the same exact callback used during authorization. PKCE clients must use S256.
7. If the old `.keys/jwt.hmac` exists without an RSA key pair, move it to a protected backup and let the service generate RSA keys, or explicitly provision a strong HS256 secret. Old test HMAC files are no longer loaded automatically. Replacing signing keys invalidates existing tokens.

Use one instance and persist `.keys/`. Restarting discards authorization codes and refresh tokens. Repeated users may have to sign in again. Stores evict their oldest entry when they reach 10,000 entries. Refresh rotation no longer extends the original session's expiration.

The Compose file now binds the backend to loopback, mounts signing keys in a named volume, and runs the container without root privileges. Adjust private networking if your TLS proxy is in a separate container. Ensure the new volume contains the signing keys you intend to retain and is writable by the `bun` user.

## Validation and rollback

Run `bun run typecheck`, `bun run lint`, `bun run test`, `bun audit`, and `bun run build` from `radius-proxy/`. The automated suite includes OAuth flow, replay/concurrency, PKCE/nonce, issuer/audience validation, HTTP controls and local authenticated UDP fixtures.

Then verify against the real Grafana and RADIUS services: MFA login, rejected credentials, token exchange, group/admin mapping, optional team sync, token refresh and RADIUS failover. Synthetic tests cannot establish compatibility with your deployed RADIUS server or Grafana permissions.

For rollback, switch to the previous image and restore its configuration and key backup if changed. Existing ephemeral sessions will need to authenticate again. Do not reuse a known test signing key in production.
