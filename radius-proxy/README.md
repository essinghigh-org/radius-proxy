Radius OAuth Proxy Demo
=======================

This project is a minimal OAuth 2.0 authorization-code style bridge in front of a RADIUS server so tools like Grafana can authenticate against RADIUS credentials. It is built on Next.js App Router APIs.

Key Endpoints
-------------
* `GET /api/oauth/authorize` – Starts auth, redirects to `/login` UI.
* `POST /api/oauth/authorize` – Validates user/pass via RADIUS and issues a one-time code (in-memory) or redirects back with `error=` on failure.
* `POST /api/oauth/token` – Exchanges code for `access_token` + `id_token` (JWT). Adds `email` and `groups` claims (no direct role claim).
* `GET /api/oauth/userinfo` – Basic user profile (sub, name, groups).
* `GET /api/oauth/userinfo/emails` – Returns an array like `[{ email, primary: true }]` (required by Grafana when it requests emails). Email is synthesized as `<sub>@EMAIL_SUFFIX`.

Environment / Config
--------------------
Values can come from `config.toml` or environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `OAUTH_CLIENT_ID` | OAuth client id expected from Grafana | `grafana` |
| `OAUTH_CLIENT_SECRET` | Secret validated at token exchange | `secret` |
| `RADIUS_HOST` | RADIUS server host | `127.0.0.1` |
| `RADIUS_SECRET` | Shared secret for RADIUS | `secret` |
| `ISSUER` | Override JWT issuer (else derived from request) | (request origin) |
| `EMAIL_SUFFIX` | Domain appended to username for synthesized email | `example.local` |
| `PERMITTED_CLASSES` | Comma-separated list of allowed RADIUS Class values; others denied | (empty = allow all) |

Email Handling
--------------
If your RADIUS directory does not provide an email, the service fabricates one. Set `EMAIL_SUFFIX` to match your org (e.g. `EMAIL_SUFFIX=corp.internal`). Grafana will use this for user identity if configured to read email.

Error Redirects
---------------
Failed logins now redirect back to the `/login` page with absolute URLs (fixes previous 500 caused by relative redirect). Query parameters include:
`?client_id=...&redirect_uri=...&error=access_denied&error_description=...&state=...`

Development Notes
-----------------
* All test scripts use Bun. Prefer `bun` over `npm/yarn`.
* JWT keys are generated on first run into `.keys/` unless provided via `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`.
* In-memory authorization codes (`global._oauth_codes`) are NOT suitable for multi-process or production environments.

Scripts
-------
```
Group Mapping Flow
------------------
RADIUS Class attribute(s) → (split on `;` or `,`) → raw tokens → `groups` claim → Grafana `groups_attribute_path = groups[*]` (you map them as needed in Grafana).

Class Enforcement
-----------------
If `PERMITTED_CLASSES` is set (e.g. `PERMITTED_CLASSES="admin_group,editor_group,viewer_group"`) only users whose RADIUS Class matches one of those values proceed; others receive an OAuth `access_denied` error.

Example: RADIUS returns `admin_class` → groups claim: `["admin_class","admin"]`.

Grafana config snippet:
```
groups_attribute_path = groups[*]
role_attribute_path = contains(groups[*], 'admin') && 'Admin' || contains(groups[*], 'editor') && 'Editor' || 'Viewer'
```
If you do not want automatic role derivation at all, omit `role_attribute_path` and just use groups for dashboard permissions or org mapping.

bun run dev           # start Next.js dev server
bun run test:emails   # run emails endpoint test
bun run test:groups   # run groups claim test
bun run test:radius   # run RADIUS auth integration script
bun run test:all      # run all tests sequentially
bun run lint          # eslint
bun run typecheck     # typescript compiler check
```

---
Below is the original Next.js scaffold README for reference:

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
