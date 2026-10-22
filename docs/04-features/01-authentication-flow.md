# Authentication flow

1. Grafana redirects the browser to `/radius_login/api/oauth/authorize` with its client ID, registered callback, state, scopes and optional S256 PKCE challenge and OIDC nonce.
2. The bridge validates the OAuth parameters and redirects to its login form, preserving those parameters.
3. The user submits credentials to the bridge. The username portion before `@` is sent to the active RADIUS server; email claims use EMAIL_SUFFIX. The browser displays an MFA reminder after two seconds.
4. The bridge verifies the RADIUS Response Authenticator and Message-Authenticator, extracts groups and applies PERMITTED_CLASSES.
5. It creates an expiring authorization code bound to the client, callback and optional PKCE challenge, then redirects the browser to Grafana with the code and original state.
6. Grafana exchanges the code over the back channel using its client credentials, original redirect_uri and optional PKCE verifier. The bridge consumes the code once and issues access, ID and refresh tokens.
7. Grafana fetches UserInfo and emails using the access token. ADMIN_CLASSES determines the optional GrafanaAdmin role. CLASS_MAP can trigger best-effort team API updates.
8. A refresh token can later be exchanged once for replacement tokens. Rotation preserves the original expiration deadline. It reuses stored groups and does not prompt RADIUS again.

All endpoints use the explicitly configured ISSUER. Run one bridge instance because authorization codes and refresh tokens are stored in memory. See [API reference](../05-api-reference/01-oauth-endpoints.md) for exact fields and errors.
