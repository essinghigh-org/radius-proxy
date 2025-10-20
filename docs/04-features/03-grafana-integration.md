# Grafana Integration

`radius-proxy` is purpose-built to integrate seamlessly with Grafana's "Generic OAuth" authentication option. This integration goes beyond simple authentication and includes advanced features like role mapping and automatic team synchronization.

## JWT Claims for Grafana

When Grafana receives an `id_token` from the proxy, it uses the claims within the JWT payload to provision the user's session. `radius-proxy` generates a specific set of claims tailored for Grafana's consumption.

**Code Reference**: The claims are assembled in `app/api/oauth/token/route.ts`.

An example JWT payload might look like this:

```json
{
  "sub": "jdoe",
  "name": "jdoe",
  "email": "jdoe@example.local",
  "groups": ["finance-team", "vpn-users"],
  "role": "GrafanaAdmin",
  "iss": "https://auth.mycompany.com",
  "aud": "grafana",
  "iat": 1678886400,
  "exp": 1678890000
}
```

Key claims used by Grafana:

-   `sub` (Subject): This is used as the user's unique identifier. It is set to the RADIUS username.
-   `name`: The display name for the user in Grafana. Also set to the RADIUS username.
-   `email`: The user's email address. This is synthesized by combining the username (`sub`) with the `EMAIL_SUFFIX` from the configuration (e.g., `jdoe` + `@example.local` = `jdoe@example.local`).
-   `groups`: An array of strings representing the user's group memberships. This is derived from the RADIUS `Class` attribute (or another attribute specified by `RADIUS_ASSIGNMENT`). If the `Class` attribute contains delimiters (`;` or `,`), it is split into multiple groups.
-   `role`: This claim is used to determine the user's organization role in Grafana. Its value is determined by the `ADMIN_CLASSES` configuration.

## Role Mapping

`radius-proxy` can dynamically assign a user's role in Grafana (Viewer, Editor, or Admin) based on their RADIUS group.

This is controlled by the `ADMIN_CLASSES` parameter in `config.toml`.

-   **Mechanism**: When a user logs in, the proxy checks if any of the user's groups (from the `Class` attribute) are present in the `ADMIN_CLASSES` list.
-   **Behavior**: If there is a match, the proxy includes the claim `"role": "GrafanaAdmin"` in the JWT.
-   **Grafana Configuration**: To make this work, you must configure Grafana's `role_attribute_path` to interpret this claim. A common JMESPath expression for this is:

    ```ini
    # In grafana.ini
    [auth.generic_oauth]
    role_attribute_path = "contains(groups, 'grafana-admins') && 'Admin' || 'Viewer'"
    ```
    Or, if using the `role` claim directly:
    ```ini
    role_attribute_path = "role == 'GrafanaAdmin' && 'Admin' || 'Viewer'"
    ```

This allows you to manage Grafana administrative privileges directly from your RADIUS server.

## Automatic Team Synchronization

A powerful feature of the proxy is its ability to automatically manage a user's team memberships in Grafana.

**Code Reference**: `lib/grafana.ts` and the asynchronous block in `app/api/oauth/token/route.ts`.

### How It Works

1.  **Configuration**: This feature is enabled by configuring the `GRAFANA_BASE_URL`, `GRAFANA_SA_TOKEN`, and `CLASS_MAP` parameters in `config.toml`.

    ```toml
    # URL of your Grafana instance
    GRAFANA_BASE_URL = "https://grafana.mycompany.com"

    # A Grafana Service Account token with appropriate permissions
    GRAFANA_SA_TOKEN = "glsa_..."

    # Mapping of RADIUS groups to Grafana Team IDs
    [CLASS_MAP]
    finance-team = [1, 5]
    engineering-team = [2]
    ```

2.  **Trigger**: After a user successfully authenticates and a token is issued, the proxy triggers an asynchronous (non-blocking) process.

3.  **User Lookup**: The proxy first needs to find the user's numeric `userId` in Grafana. It does this by making an API call to Grafana's `/api/org/users/lookup` endpoint using the user's email address.
    -   **Retry Logic**: Because a user might be logging in for the first time, their account may not be fully provisioned in Grafana when the token is issued. The proxy includes a retry mechanism with exponential backoff to handle this potential race condition, polling the lookup endpoint a few times before giving up.

4.  **Team Membership Check**: Before adding a user to a team, the proxy first fetches the team's current member list to see if the user is already a member. This makes the process idempotent and avoids unnecessary API calls.

5.  **Add to Team**: If the user is not already a member, the proxy makes a `POST` request to Grafana's `/api/teams/{teamId}/members` endpoint to add the user to the team.

### Permissions

For this feature to work, the Grafana Service Account token provided in `GRAFANA_SA_TOKEN` must have the following permissions:

-   **Users**: `users:read` (to look up users by email).
-   **Teams**: `teams:read` and `teams.write` (to check and add team members).

### Insecure TLS

For development or internal environments where Grafana might be using a self-signed TLS certificate, you can set `GRAFANA_INSECURE_TLS = true`. This will temporarily disable TLS certificate validation for the API calls made from the proxy to Grafana. **This is insecure and should not be used in a production environment exposed to the internet.**
