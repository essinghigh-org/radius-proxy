# Troubleshooting

**Startup rejects configuration:** set a random OAuth client secret of at least 32 characters, the real RADIUS shared secret, an explicit ISSUER and a nonempty REDIRECT_URIS allowlist. Do not run from the example file. A public issuer must use HTTPS with no path or trailing slash. Ensure TOML regex values use valid escaping or single-quoted literal strings.

**Signing-key errors:** keep `.keys/` writable by the application user. Supply both PEM keys if using environment values. A legacy `jwt.hmac` requires an intentional migration; see [migration notes](04-migration.md). Test mode never persists keys.

**invalid_client:** check that the client ID and secret in Grafana exactly match the proxy. Use either Basic authentication or form client_secret, not both. Changing the secret requires updating both sides.

**invalid_request on authorization:** check that the callback is an exact REDIRECT_URIS match, including the full `/login/generic_oauth` path and any query. PKCE must use S256 with a valid challenge and method. Duplicate form fields are rejected.

**invalid_grant:** start a fresh sign-in. Codes and refresh tokens are single-use, expire, and are lost on restart. Code exchange must supply the original redirect_uri and matching PKCE verifier. Run one bridge instance. Keep clocks synchronized.

**All logins time out:** check UDP connectivity, the client source address and shared secret on the RADIUS server. Every Accept and Reject must contain Message-Authenticator. Missing-MAC responses produce a warning and are dropped even if the legacy Response Authenticator is valid. Allow enough RADIUS_TIMEOUT for MFA.

**Correct credentials are denied:** verify PERMITTED_CLASSES and the configured group attribute or vendor extraction pattern. Empty PERMITTED_CLASSES permits all authenticated users. Both failed credentials and a disallowed group produce access_denied.

**429 responses:** the account/peer authorization limit is 20 per minute. Wait for Retry-After. Token exchanges use a separate path and do not consume this bucket. A reverse proxy may impose its own additional limits.

**Team synchronization fails:** verify GRAFANA_BASE_URL, the service-account permissions and CLASS_MAP. Check `[grafana]` logs for lookup and membership errors. Ensure EMAIL_SUFFIX matches Grafana accounts. For internal certificates, configure CA trust; prefer that to GRAFANA_INSECURE_TLS.

Development logs are written to `.logs/debug.log`; warnings and errors appear on the console. Production uses console logging unless FORCE_FILE_LOGS is enabled. Protect and rotate logs. Tokens and credentials should not be added to diagnostic output.
