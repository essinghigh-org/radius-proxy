# Main configuration

Copy `radius-proxy/config.example.toml` to the application's `config.toml` (or to the repository root when using Compose). The example is not loaded outside tests. Environment variables override file values. Bun parses TOML; use single-quoted literal strings for regex patterns containing backslashes.

File changes reload on access. Invalid changes retain the last valid configuration. Restart after changing HTTP binding, the health-check interval or JWT keys.

## OAuth and HTTP

| Setting | Default | Meaning |
| --- | --- | --- |
| `OAUTH_CLIENT_ID` | `grafana` | Must match the Grafana OAuth client ID. |
| `OAUTH_CLIENT_SECRET` | none; required | Random secret of at least 32 characters, also configured in Grafana. Example secrets are rejected. |
| `ISSUER` | none; required | Public HTTPS origin without a path or trailing slash. Loopback development may use HTTP. |
| `REDIRECT_URIS` | none; required | TOML array of exact registered callbacks, including path and query. No wildcard or same-origin fallback. |
| `HTTP_HOST` | `0.0.0.0` | Backend bind address. Keep it on a private interface/network. |
| `HTTP_PORT` | `54567` | Backend HTTP port. |
| `OAUTH_CODE_TTL` | `600` | Authorization-code lifetime in seconds. |
| `OAUTH_REFRESH_TOKEN_TTL` | `7776000` | Refresh-session lifetime in seconds, at most one year. Rotation preserves the original expiration. |

## RADIUS

Every server must send a valid Message-Authenticator on every response. See [security](../04-features/04-security.md).

| Setting | Default | Meaning |
| --- | --- | --- |
| `RADIUS_HOST` | `127.0.0.1` | Single-server address, used when no host list is set. |
| `RADIUS_HOSTS` | single-server address | Ordered TOML array of servers for failover. |
| `RADIUS_SECRET` | none; required | Actual shared secret, common to the configured servers. Example secrets are rejected. |
| `RADIUS_PORT` | `1812` | UDP destination port. |
| `RADIUS_TIMEOUT` | `5` | Authentication timeout in seconds; allow enough time for MFA. |
| `RADIUS_HEALTHCHECK_INTERVAL` | `1800` | Background probe interval in seconds, minimum effective interval five seconds. |
| `RADIUS_HEALTHCHECK_TIMEOUT` | `5` | Probe timeout in seconds. |
| `RADIUS_HEALTHCHECK_USER` | `grafana_dummy_user` | Dummy probe username. A signed rejection counts as alive. |
| `RADIUS_HEALTHCHECK_PASSWORD` | `dummy_password` | Dummy probe password. |
| `RADIUS_ASSIGNMENT` | `25` | Attribute used for group mapping; 25 is Class, 26 is vendor-specific. |
| `RADIUS_VENDOR_ID` | unset | Vendor ID for attribute 26. |
| `RADIUS_VENDOR_TYPE` | unset | Vendor subtype for attribute 26. |
| `RADIUS_VALUE_PATTERN` | unset | Regex whose first capture group supplies the group name. |

Example Cisco role extraction:

```toml
RADIUS_ASSIGNMENT = 26
RADIUS_VENDOR_ID = 9
RADIUS_VENDOR_TYPE = 1
RADIUS_VALUE_PATTERN = 'shell:roles=([^,\s]+)'
```

## Users and Grafana

| Setting | Default | Meaning |
| --- | --- | --- |
| `EMAIL_SUFFIX` | `example.local` | Domain used for every email claim and Grafana team lookup. User-supplied domains are ignored. |
| `PERMITTED_CLASSES` | empty | Comma-separated allowed groups. Empty permits every authenticated user. |
| `ADMIN_CLASSES` | empty | Comma-separated groups that receive the GrafanaAdmin role. |
| `GRAFANA_BASE_URL` | unset | Grafana origin used for optional team API calls. |
| `GRAFANA_SA_TOKEN` | unset | Service-account token for optional team synchronization. |
| `GRAFANA_INSECURE_TLS` | `false` | Disable TLS verification only for Grafana requests. Prefer configuring CA trust. |
| `CLASS_MAP` | empty | Inline table mapping group names to numeric Grafana team IDs. |

```toml
CLASS_MAP = { grafana_users = [2, 6], operators = [9] }
```

JWT key and logging options are environment-only; see [environment variables](02-environment-variables.md).
