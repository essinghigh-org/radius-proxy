# Security

The service requires an explicitly configured issuer, callback allowlist and secrets. It never uses `config.example.toml` outside tests. The OAuth client secret must contain at least 32 characters, and known example secrets are rejected.

Callback URIs are matched exactly, including query strings, before authentication or code issuance. Codes are bound to the client and original redirect URI, expire, and are consumed atomically in this process. Refresh tokens rotate on use and retain their original expiration deadline. Replays fail. Invalid redemption attempts consume the submitted code or refresh token.

PKCE supports S256 only. Challenge, method, scope, state and nonce survive the login page. The service rejects malformed challenges and requires the matching verifier during token exchange. ID tokens include the supplied nonce. UserInfo accepts access tokens only and checks issuer, audience, expiry and allowed signing algorithm.

The configured issuer is authoritative. Caller-supplied Host and X-Forwarded-* headers cannot alter token issuers, callback validation or discovery URLs. Browser credential submissions with a foreign Origin are rejected. Authorization attempts are limited to 20 per account and socket peer per minute; changing forwarding headers cannot bypass this. Token exchange uses a separate path and does not consume login rate limits. Behind a reverse proxy, users of the same account share this bucket; an attacker who knows a username can temporarily lock it out. Apply per-client request limits at the trusted edge proxy to reduce this account-lockout trade-off. Forwarded addresses are not trusted by the application.

Requests are limited to 16 KiB. Form handlers reject duplicate fields and binary values. Login HTML escapes query values. Responses include CSP, framing protection, no-sniff, same-origin referrer and no-store headers; an HTTPS issuer also enables HSTS.

RADIUS replies must have matching source, identifier and length, valid attributes, a valid Response Authenticator and a valid Message-Authenticator. Missing Message-Authenticator is rejected to prevent Blast-RADIUS-style response forgery. Configure and update every RADIUS server to send it on Accept, Reject and Challenge replies. PAP and the legacy RADIUS cryptography still require a trusted network or an encrypted tunnel; the bridge does not implement RadSec.

Email addresses are constructed from the authenticated username and operator-configured EMAIL_SUFFIX. A user-supplied email domain cannot select a different Grafana account.

RSA signing keys are persisted with restricted permissions. Test keys are random, held only in memory and never written to disk. Legacy `jwt.hmac` files are not automatically loaded. An explicit HS256 secret must be at least 32 bytes. Signing-key failures stop startup rather than silently changing algorithms.

Grafana API calls verify TLS by default. The optional insecure setting affects only those requests, never process-wide TLS verification. Calls reject redirects and time out after ten seconds. Prefer installing your internal CA using Bun's supported certificate configuration.

This is a single-instance service. In-memory stores are bounded to 10,000 entries each and evict the oldest session at capacity. Restarts discard refresh tokens and authorization codes. See [migration notes](../06-guides/04-migration.md) for compatibility changes and validation limits.
