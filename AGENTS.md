# AI Agent Guide (radius-proxy)

Purpose: Bridge Grafana OAuth2 login to a legacy RADIUS source.
Core flow: RADIUS PAP auth -> OAuth authorization code -> JWT (access & id) -> optional Grafana team assignment.

Runtime & config
- Config hot-reload: use [`lib/config.ts`](radius-proxy/lib/config.ts:1). Always read values from config at runtime; do not cache at module top.
- TOML + env overrides; arrays are comma-split. `CLASS_MAP` accepts TOML inline, loose syntax, or JSON.

RADIUS authentication
- Primary implementation: [`lib/radius.ts`](radius-proxy/lib/radius.ts:1). Use PAP, verify authenticator, extract Class (type 25).
- Legacy helpers (tests & fakes): [`lib/radius_client.js`](radius-proxy/lib/radius_client.js:1), [`lib/radius_net.js`](radius-proxy/lib/radius_net.js:1).

OAuth endpoints (Next.js route handlers)
- Authorize (POST): [`app/radius_login/api/oauth/authorize/route.ts`](radius-proxy/app/radius_login/api/oauth/authorize/route.ts:1) — validate client, call radiusAuthenticate, enforce permitted class via [`lib/access.ts`](radius-proxy/lib/access.ts:1), store one-time code, redirect using `config.REDIRECT_URIS` or same-origin.
- Token (POST): [`app/radius_login/api/oauth/token/route.ts`](radius-proxy/app/radius_login/api/oauth/token/route.ts:1) — exchange code for tokens, support refresh token rotation, run async Grafana team add after issuing tokens.
- Userinfo & emails: [`app/radius_login/api/oauth/userinfo/route.ts`](radius-proxy/app/radius_login/api/oauth/userinfo/route.ts:1), [`app/radius_login/api/oauth/userinfo/emails/route.ts`](radius-proxy/app/radius_login/api/oauth/userinfo/emails/route.ts:1) — derive claims from JWT; synthesize emails as `<sub>@EMAIL_SUFFIX`.

Storage
- In-memory storage only: [`lib/storage.ts`](radius-proxy/lib/storage.ts:1). Use `getStorage()`; do not add global maps elsewhere. Storage supports auth codes, refresh tokens, and periodic cleanup.

Tokens & keys
- JWT helpers: [`lib/jwt.ts`](radius-proxy/lib/jwt.ts:1). Use HS256 for test/env or RS256 (generated keypair) in other environments. Prefer `signToken` / `verifyToken`.

Grafana integration
- Team mapping via `CLASS_MAP`. Implementation in [`lib/grafana.ts`](radius-proxy/lib/grafana.ts:1) performs async, idempotent adds and keeps simple in-flight and recent-success caches.

Utilities
- Resolver for issuer/origin: use `getIssuer(req)` implemented in [`lib/server-utils.ts`](radius-proxy/lib/server-utils.ts:1).
- Logging: [`lib/log.ts`](radius-proxy/lib/log.ts:1) — debug/info/warn gated by `DEBUG` or non-production; errors always logged.

Key conventions
- Class parsing: the RADIUS `Class` attribute may contain tokens separated by `,` or `;`. Split accordingly and use token lists for permission checks.
- Claims injected in both access & id tokens: `groups`, `grafana_admin` (boolean) and optional `role` (e.g., GrafanaAdmin).
- Redirect safety: when `REDIRECT_URIS` is non-empty only allow exact matches (full URL or origin+path); otherwise require same-origin.
- Timeouts: pass milliseconds explicitly to `radiusAuthenticate`; `RADIUS_TIMEOUT` in config is seconds.
- Config hot-reload: do not memoize values you expect to change at runtime.

Developer & test workflows
- Dev server: run from project root: `bun run --cwd radius-proxy dev`. Uses Next.js 15 + Turbopack.
- Tests (Bun): `bun run test:all` or targeted scripts like `bun run test:radius`.
- Integration tests spin ephemeral fake RADIUS UDP servers (see tests in [`radius-proxy/tests/`](radius-proxy/tests/:1) such as [`tests/oauth_integration.test.js`](radius-proxy/tests/oauth_integration.test.js:1)).
- Deterministic JWTs in tests: `NODE_ENV=test` uses HS256 fixed secret from `.keys/jwt.hmac` or fallback.

Adding features
- To add persistence: replace `MemoryStorage` behind `getStorage()` without changing callers.
- New claims: add to token exchange (all grant types) and mirror in userinfo routes; update tests to assert presence.
- Additional OAuth flows: extend the switch in [`app/radius_login/api/oauth/token/route.ts`](radius-proxy/app/radius_login/api/oauth/token/route.ts:1). Keep spec error strings (`invalid_client`, `invalid_grant`, etc.).
- RADIUS attributes: extend parser in [`lib/radius.ts`](radius-proxy/lib/radius.ts:1) and keep safety checks (length bounds) and authenticator verification.

Quick file map
- OAuth handlers: [`app/radius_login/api/oauth/**/route.ts`](radius-proxy/app/radius_login/api/oauth/:1)
- Core protocol: [`lib/radius.ts`](radius-proxy/lib/radius.ts:1), legacy helpers [`lib/radius_net.js`](radius-proxy/lib/radius_net.js:1)
- AuthZ: [`lib/access.ts`](radius-proxy/lib/access.ts:1)
- Config & hot reload: [`lib/config.ts`](radius-proxy/lib/config.ts:1)
- Identity & tokens: [`lib/jwt.ts`](radius-proxy/lib/jwt.ts:1)
- Grafana integration: [`lib/grafana.ts`](radius-proxy/lib/grafana.ts:1)
- Storage: [`lib/storage.ts`](radius-proxy/lib/storage.ts:1)

Important notes
- Do not ask the user to add a database; in-memory storage is acceptable for this project.
- Backwards compatibility is not required; breaking changes are allowed.
- Use Bun for development and tests.
- For commits that don't require publishing a new Docker image, include "skip_publish" in the commit message.

Concise checklist for agent tasks
- Read runtime values from [`lib/config.ts`](radius-proxy/lib/config.ts:1)
- Authenticate via [`lib/radius.ts`](radius-proxy/lib/radius.ts:1)
- Use `getStorage()` from [`lib/storage.ts`](radius-proxy/lib/storage.ts:1)
- Sign/verify tokens via [`lib/jwt.ts`](radius-proxy/lib/jwt.ts:1)
- Run dev with Bun and run tests with Bun

End.