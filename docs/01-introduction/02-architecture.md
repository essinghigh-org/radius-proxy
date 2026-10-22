# Architecture

The service runs on Bun and Elysia. `radius-proxy/server.ts` registers HTTP routes, request limits, security headers, static assets and shutdown handling. `routes/` contains OAuth and OIDC handlers using standard Request/Response objects.

The login page is rendered by `lib/login.ts`; `public/login.css` and `public/login.js` provide its styling and form submission. It has no React runtime or frontend build step. Normal form submission also works without JavaScript. JavaScript displays an MFA prompt after two seconds and navigates to the validated callback returned by the server.

`lib/radius.ts` implements UDP RADIUS PAP, response authentication and Class/vendor attribute extraction. `lib/radius_hosts.ts` tracks the active server and probes configured servers for failover. Only authenticated replies count as liveness.

`lib/config.ts` parses TOML using Bun, overlays environment variables, validates startup configuration and reloads file changes. An invalid reload retains the last valid configuration. HTTP binding, health-check intervals and signing-key changes require a restart.

`lib/storage.ts` keeps authorization codes and refresh tokens in separate, bounded in-memory maps. Redemption removes the entry before asynchronous work, preventing concurrent reuse in one process. Each store holds up to 10,000 entries; the oldest entry is revoked when capacity is reached. Expired entries are pruned on writes and periodically.

`lib/jwt.ts` signs tokens using persisted RSA keys by default. It accepts an explicitly configured HS256 secret for deployments that do not require public-key discovery. Access tokens are checked for expiry, issuer, audience, algorithm and token purpose.

`lib/grafana.ts` optionally adds authenticated users to mapped teams. Requests have a timeout, reject redirects, and configure TLS verification per request. Team updates are best effort and do not block token issuance.

Run one instance. Codes and refresh tokens are not shared, and refresh rotation requires a single process. Restarts invalidate outstanding codes and refresh tokens. Persisted signing keys allow already-issued access tokens to remain valid until expiry.
