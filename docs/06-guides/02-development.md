# Development

The application requires Bun 1.4.3 or newer. Start from `radius-proxy/`:

```sh
bun install --frozen-lockfile --ignore-scripts
cp config.example.toml config.toml
# Set real development secrets, an issuer and callback allowlist.
bun run dev
```

Bun watches the Elysia entry point. There is no separate frontend build server. Edit `lib/login.ts`, `public/login.css` and `public/login.js` for the login screen.

```sh
bun run typecheck
bun run lint
bun run test
bun audit
bun run build
```

Use `bun run test` for the full suite. It runs each test file in a separate process because Bun module mocks otherwise leak across files. An individual suite can be run with `bun test tests/security.test.ts`. Tests use explicit fixture secrets and in-memory signing keys. UDP tests start local RADIUS fixtures; they do not require production servers.

Type checking uses TypeScript 7.0.2. ESLint currently needs the TypeScript 6 programmatic API, so `typescript` aliases the official compatibility package and `@typescript/native` supplies the current `tsc` executable. Both are pinned in `bun.lock`.

`server.ts` registers routes and shared HTTP controls; `routes/` contains OAuth handlers; `lib/` contains configuration, RADIUS, storage, JWT and Grafana integration. Container publication is gated on types, lint, tests, audit, bundle and Docker build checks.
