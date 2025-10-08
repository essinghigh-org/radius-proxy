# AI Agent Guide (radius-proxy)

Purpose: Bridge Grafana OAuth2 login to a legacy / external RADIUS source. Core flow: RADIUS PAP auth -> OAuth authorization code -> JWT (access/id) + optional Grafana team assignment.

## Architecture (server side first)
- Config hot‑reload via `lib/config.ts` Proxy + fs.watch; always read runtime values from `config` (never cache at module top). TOML + env overrides; arrays: comma split; `CLASS_MAP` supports TOML inline, loose syntax, or JSON.
- RADIUS auth: minimal client (`lib/radius.ts`) does PAP, authenticator verification, extracts Class (type 25). Older JS helpers kept in `radius_client.js` / `radius_net.js` for tests & fake servers.
- OAuth endpoints (Next.js route handlers):
  - `authorize/route.ts` POST: validates client, calls `radiusAuthenticate`, enforces permitted class (`lib/access.ts`), stores one‑time code in storage, redirects (allowlist: `config.REDIRECT_URIS` or same‑origin).
  - `token/route.ts` POST: exchanges code -> access/id/refresh tokens; later grant_type=refresh_token rotation logic; performs async Grafana team add after issuing tokens.
  - `userinfo` + `userinfo/emails`: derive claims from JWT; emails synthesized `<sub>@EMAIL_SUFFIX`.
- Storage: in‑memory only (`lib/storage.ts`) with unified interface supporting auth codes + refresh tokens + periodic cleanup (`cleanupExpiredCodes`). Do not introduce global maps elsewhere—use `getStorage()`.
- JWT: `lib/jwt.ts` chooses HS256 (test/env) or generates RS256 keypair; prefer using `signToken/verifyToken`. Kid auto set for RSA.
- Grafana team mapping: `CLASS_MAP` (group/class -> team IDs). Async, idempotent add in `lib/grafana.ts` with simple in‑flight + recent success caches.
- Issuer/origin resolution: always use `getIssuer(req)` (respects X-Forwarded-* or `config.ISSUER`).

## Key Conventions / Patterns
- Class/group parsing: RADIUS `Class` attr may contain multiple tokens separated by `,` or `;`; splitting logic duplicated in authorize route; permitted/admin matching uses token list.
- Claims: `groups`, `grafana_admin` (boolean), and optional `role` (GrafanaAdmin) are injected into both access & id tokens.
- Redirect safety: If `REDIRECT_URIS` non-empty, only exact match (full URL or origin+path) allowed; else must be same origin as request.
- Timeouts: Pass milliseconds explicitly to `radiusAuthenticate`; config value `RADIUS_TIMEOUT` is seconds.
- Logging: `lib/log.ts` gates debug/info/warn on `DEBUG` or non-production. Errors always surface.
- Config edits at runtime propagate automatically—never memoize a value you intend to observe changing.

## Developer / Test Workflows
- Dev server: from project root `bun run --cwd radius-proxy dev` (or cd into folder then `bun run dev`). Uses Next.js 15 + Turbopack.
- Tests (Bun): root scripts proxy: `bun run test:all` (runs targeted test scripts). Individual: `bun run test:radius`, `bun run test:emails`, etc.
- Integration tests spin an ephemeral fake RADIUS UDP server (see `tests/radius.test.js`, `tests/oauth_integration.test.js`) using helpers in `lib/radius_net.js`.
- Refresh token scenarios covered in `tests/oauth_refresh_integration.test.js` (jest mocks `config`, `radius`, `server-utils`). Keep new logic mock-friendly (avoid side effects during import).
- Deterministic JWT for tests: `NODE_ENV=test` triggers HS256 fixed secret (persisted `.keys/jwt.hmac` or fallback); do not rely on external key material in tests.

## When Adding Features
- Need persistence: replace `MemoryStorage` behind `getStorage()` without changing caller contracts (auth code & refresh token methods both required).
- New claims: add in token exchange (both grant types) and mirror in `userinfo` routes; ensure tests assert presence.
- Additional OAuth flows: extend `token/route.ts` switch; keep existing error strings (`invalid_client`, `invalid_grant`, etc.) per spec.
- RADIUS attributes: extend parser in `lib/radius.ts`; maintain safety checks (length bounds) & authenticator verification.

## Quick File Map
- OAuth handlers: `app/api/oauth/**/route.ts`
- Core protocol: `lib/radius.ts`, legacy helpers `lib/radius_net.js`
- AuthZ logic: `lib/access.ts`
- Config & hot reload: `lib/config.ts`
- Identity & tokens: `lib/jwt.ts`
- Grafana integration: `lib/grafana.ts`
- Storage abstraction: `lib/storage.ts`

## Important Notes

- When working on this project, do not bug the user about using a database. In-Memory is fine for this project
- There is absolutely zero need to retain backwards compatibility, breaking changes are allowed
- Always use bun, nothing else