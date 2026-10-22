# Installation

Install Bun 1.4.3 or newer, then run from the repository root:

```sh
cd radius-proxy
bun install --frozen-lockfile --ignore-scripts
cp config.example.toml config.toml
```

Edit `config.toml` before starting:

- Set a randomly generated `OAUTH_CLIENT_SECRET` of at least 32 characters. Configure the same secret in Grafana.
- Set the actual RADIUS shared secret and hosts. Example credentials are rejected.
- Set `ISSUER` to the public HTTPS origin, without a path or trailing slash. HTTP is allowed only for loopback development.
- Set `REDIRECT_URIS` to Grafana's exact callback URI, typically `https://grafana.example.com/login/generic_oauth`.
- Set `EMAIL_SUFFIX` to the domain used by your Grafana accounts.

Generate an OAuth secret locally with `bun -e 'console.log(crypto.randomUUID()+crypto.randomUUID())'` and store it securely.

```sh
bun run dev
```

Open the configured issuer at `/radius_login`. To test the whole flow, start sign-in from Grafana so it supplies the OAuth callback and state.

For production, put an HTTPS reverse proxy in front of the application, restrict the backend port, and run:

```sh
bun run build
NODE_ENV=production bun dist/server.js
```

Run from the application directory so `config.toml`, `public/` and `.keys/` resolve correctly. The service creates `.keys/` with restricted permissions; retain this directory across upgrades.
