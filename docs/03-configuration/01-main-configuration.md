# Main Configuration (`config.toml`)

`radius-proxy` is configured primarily through a TOML file. The application looks for `config.toml` in the working directory at startup. If it's not found, it falls back to `config.example.toml`.

This document provides a comprehensive reference for every available parameter.

--- 

## [OAuth 2.0 / OIDC]

These settings define the behavior of the proxy as an OAuth 2.0 and OpenID Connect provider.

### `OAUTH_CLIENT_ID`
-   **Type**: `String`
-   **Default**: `"grafana"`
-   **Description**: The client ID that Grafana (or any other OAuth client) must use to identify itself. This must match the `client_id` configured in Grafana's Generic OAuth settings.

### `OAUTH_CLIENT_SECRET`
-   **Type**: `String`
-   **Default**: `"secret"`
-   **Description**: The client secret that Grafana must use to authenticate itself during the token exchange. This must match the `client_secret` configured in Grafana.

### `OAUTH_CODE_TTL`
-   **Type**: `Number`
-   **Default**: `600`
-   **Description**: The Time-To-Live (TTL) for authorization codes, in seconds. An authorization code is issued after a successful login and must be exchanged for a token within this timeframe. A longer TTL may be convenient but increases the risk if a code is intercepted.

### `OAUTH_REFRESH_TOKEN_TTL`
-   **Type**: `Number`
-   **Default**: `7776000` (90 days)
-   **Description**: The Time-To-Live (TTL) for refresh tokens, in seconds. Refresh tokens allow Grafana to obtain new access tokens without requiring the user to log in again.

### `REDIRECT_URIS`
-   **Type**: `Array of Strings`
-   **Default**: `[]`
-   **Description**: A list of allowed redirect URIs. When Grafana initiates a login, it provides a `redirect_uri` where the user should be sent back after authentication. To prevent open redirect vulnerabilities, the proxy will only redirect to URIs that are on this allowlist. The URI must be an exact match, including the path.
-   **Example**: `REDIRECT_URIS = ["https://grafana.mycompany.com/login/generic_oauth"]`

### `ISSUER`
-   **Type**: `String`
-   **Default**: (derived from request headers)
-   **Description**: The canonical, public-facing base URL of the `radius-proxy` service. This URL is used to construct the endpoints in the OIDC discovery document (e.g., `authorization_endpoint`, `token_endpoint`). It should be the URL that Grafana and end-users can reach. If not set, the proxy attempts to derive it from `X-Forwarded-*` or `Host` headers.
-   **Example**: `ISSUER = "https://auth.mycompany.com"`

---

## [RADIUS]

These settings configure the connection to your RADIUS servers.

### `RADIUS_HOSTS`
-   **Type**: `Array of Strings`
-   **Default**: `["127.0.0.1"]`
-   **Description**: An ordered list of RADIUS server IP addresses or hostnames. The proxy will always try the first server in the list. If it becomes unresponsive, it will fail over to the next one in the list. See the [RADIUS Failover](./../04-features/02-radius-failover.md) documentation for more details.
-   **Example**: `RADIUS_HOSTS = ["10.0.0.1", "10.0.0.2", "10.0.0.3"]`

### `RADIUS_SECRET`
-   **Type**: `String`
-   **Default**: `"secret"`
-   **Description**: The shared secret used to encrypt and validate communication with all configured RADIUS servers.

### `RADIUS_PORT`
-   **Type**: `Number`
-   **Default**: `1812`
-   **Description**: The UDP port on which the RADIUS servers are listening for authentication requests.

### `RADIUS_TIMEOUT`
-   **Type**: `Number`
-   **Default**: `5`
-   **Description**: The timeout in seconds for a single RADIUS authentication request. If a RADIUS server does not reply within this time, the request is considered failed, which may trigger a failover.

### `RADIUS_ASSIGNMENT`
-   **Type**: `Number`
-   **Default**: `25`
-   **Description**: The numeric code of the RADIUS attribute that contains the user's group or role information. This is used for mapping to Grafana roles and teams. The default `25` corresponds to the `Class` attribute.
-   **Examples**: `25` (Class), `11` (Filter-Id), `26` (Vendor-Specific).

### Vendor-Specific Attribute (VSA) Settings

These settings are used only when `RADIUS_ASSIGNMENT` is set to `26`.

-   **`RADIUS_VENDOR_ID`**: The vendor ID for the VSA.
-   **`RADIUS_VENDOR_TYPE`**: The vendor-specific attribute type number.
-   **`RADIUS_VALUE_PATTERN`**: A regular expression with a capture group to extract the desired value from the VSA string. For example, for a Cisco AVPair like `shell:roles=admin`, you could use `"shell:roles=([^,s]+)"` to extract `admin`.

---

## [RADIUS Health Checks]

Settings for the high-availability and failover mechanism.

### `RADIUS_HEALTHCHECK_INTERVAL`
-   **Type**: `Number`
-   **Default**: `1800` (30 minutes)
-   **Description**: The interval in seconds at which the proxy will perform background health checks on all configured RADIUS servers to monitor their liveness.

### `RADIUS_HEALTHCHECK_TIMEOUT`
-   **Type**: `Number`
-   **Default**: `5`
-   **Description**: The timeout in seconds for a single health check probe. This is separate from the main `RADIUS_TIMEOUT`.

### `RADIUS_HEALTHCHECK_USER`
-   **Type**: `String`
-   **Default**: `"grafana_dummy_user"`
-   **Description**: A dummy username to use for sending health check `Access-Request` packets.

### `RADIUS_HEALTHCHECK_PASSWORD`
-   **Type**: `String`
-   **Default**: `"dummy_password"`
-   **Description**: The password for the dummy health check user.

---

## [Server]

Configuration for the built-in HTTP server.

### `HTTP_HOST`
-   **Type**: `String`
-   **Default**: `"0.0.0.0"`
-   **Description**: The network interface on which the server will listen. `0.0.0.0` means it will listen on all available interfaces, which is required for Docker deployments.

### `HTTP_PORT`
-   **Type**: `Number`
-   **Default**: `54567`
-   **Description**: The TCP port on which the server will listen.

---

## [User & Group Management]

Settings related to user identity and permissions.

### `EMAIL_SUFFIX`
-   **Type**: `String`
-   **Default**: `"example.local"`
-   **Description**: The email domain to append to a user's RADIUS username to form their email address claim in the JWT. For example, if a user logs in as `jdoe` and the suffix is `mycompany.com`, their email claim will be `jdoe@mycompany.com`.

### `PERMITTED_CLASSES`
-   **Type**: `String` (comma-separated)
-   **Default**: `""` (empty string, meaning all are permitted)
-   **Description**: A comma-separated list of RADIUS `Class` attribute values that are allowed to log in. If a user authenticates successfully but their `Class` attribute is not in this list, their login will be rejected. If this list is empty, all users who successfully authenticate are permitted.
-   **Example**: `PERMITTED_CLASSES = "vpn-users,grafana-users,admins"`

### `ADMIN_CLASSES`
-   **Type**: `String` (comma-separated)
-   **Default**: `""`
-   **Description**: A comma-separated list of RADIUS `Class` attribute values that should be granted Grafana Admin privileges. If a user's `Class` is in this list, their JWT will include the claim `"role": "GrafanaAdmin"`.
-   **Example**: `ADMIN_CLASSES = "grafana-admins,superusers"`

---

## [Grafana Team Synchronization]

Optional settings for automatically managing Grafana team memberships.

### `GRAFANA_BASE_URL`
-   **Type**: `String`
-   **Default**: `""`
-   **Description**: The base URL of your Grafana instance. This is required for the proxy to make API calls to Grafana.
-   **Example**: `GRAFANA_BASE_URL = "https://grafana.mycompany.com"`

### `GRAFANA_SA_TOKEN`
-   **Type**: `String`
-   **Default**: `""`
-   **Description**: A Grafana Service Account token with `teams.write` and `users.read` permissions. This is required for the proxy to add users to teams.

### `GRAFANA_INSECURE_TLS`
-   **Type**: `Boolean`
-   **Default**: `false`
-   **Description**: If `true`, TLS certificate verification will be disabled for API calls made to the Grafana server. This is useful for development environments or when Grafana is using a self-signed certificate, but it is insecure and should not be used in production unless you understand the risks.

### `CLASS_MAP`
-   **Type**: `Table` / `Map`
-   **Default**: `{}`
-   **Description**: A map where keys are RADIUS `Class` attribute values and values are arrays of Grafana Team IDs. When a user logs in, the proxy will check their `Class` attribute and, if it matches a key in this map, will attempt to add the user to the corresponding Grafana teams.
-   **Example**:
    ```toml
    [CLASS_MAP]
    finance-team = [1, 5]
    engineering-team = [2, 8]
    ```
    In this example, a user with the `finance-team` class will be added to Grafana teams with IDs 1 and 5.
