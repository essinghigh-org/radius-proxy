# Troubleshooting Guide

This guide provides solutions to common problems you might encounter when setting up or running `radius-proxy`.

## Debug Logging

Before troubleshooting, it is highly recommended to enable debug logging. The application has a detailed logging system that can provide valuable insights into the authentication flow and potential errors.

-   **How to Enable**: Set the `DEBUG` environment variable to `true` or `1`.

    ```bash
    DEBUG=1 bun run dev
    ```

-   **Log Location**: When file logging is active (default in development), logs are written to `.logs/debug.log` inside the `radius-proxy` directory. This file contains structured JSON entries for every significant event.
-   **Console Output**: In development, the console output is kept clean, with only warnings and errors appearing by default. The verbose `debug` and `info` messages are written to the log file.

**Code Reference**: `lib/log.ts`

--- 

## Common Issues

### 1. Grafana shows "Login Failed" or "invalid_grant"

This is the most common issue and usually happens during the token exchange.

-   **Symptom**: After you enter your credentials and are redirected back to Grafana, you see an error message.
-   **Cause**: The `radius-proxy` rejected Grafana's request to exchange the authorization code for a token.
-   **Troubleshooting Steps**:
    1.  **Check the Proxy Logs**: The `debug.log` file will contain the exact reason for the failure. Look for entries around the `POST /api/oauth/token` request.
    2.  **Mismatched Client Secret**: Ensure the `OAUTH_CLIENT_SECRET` in your `config.toml` (or environment variable) **exactly** matches the `client_secret` you configured in Grafana's Generic OAuth settings.
    3.  **Clock Skew**: If the system clocks on the Grafana server and the `radius-proxy` server are significantly out of sync, it can cause issues with token validation (e.g., `iat` or `exp` claims). Ensure both systems are synchronized with an NTP server.
    4.  **Code Expired**: If the `OAUTH_CODE_TTL` is set to a very low value, the code might expire before Grafana has a chance to use it. Check the logs for messages about expired codes.

### 2. Redirect URI Mismatch

-   **Symptom**: After logging in, you see an error page from the proxy with the message `redirect_uri not allowed`.
-   **Cause**: The URL that Grafana is using for its callback does not exactly match any of the URIs in your `REDIRECT_URIS` configuration.
-   **Troubleshooting Steps**:
    1.  In Grafana, go to the Generic OAuth settings and copy the full URL from the "Redirect URL" field.
    2.  Paste this value into the `REDIRECT_URIS` array in your `config.toml`. It must be an **exact match**.

        ```toml
        # Incorrect
        REDIRECT_URIS = ["https://grafana.mycompany.com"]

        # Correct
        REDIRECT_URIS = ["https://grafana.mycompany.com/login/generic_oauth"]
        ```

### 3. User gets "Access Denied" or "Class not permitted"

-   **Symptom**: A user enters the correct RADIUS credentials but is still denied access.
-   **Cause**: The user was successfully authenticated by RADIUS, but their group (`Class` attribute) is not on the `PERMITTED_CLASSES` allowlist.
-   **Troubleshooting Steps**:
    1.  **Check the Proxy Logs**: The logs will show a `forbidden_class` warning with the user's username and the `Class` attribute that was received from the RADIUS server.
    2.  **Update Configuration**: Add the user's `Class` value to the `PERMITTED_CLASSES` string in your `config.toml`.

        ```toml
        # If a user has the class "network-users", add it to the list
        PERMITTED_CLASSES = "vpn-users,grafana-users,network-users"
        ```
    3.  If `PERMITTED_CLASSES` is empty, this check is skipped. Ensure it is not misconfigured.

### 4. RADIUS Authentication Fails (Timeouts)

-   **Symptom**: All login attempts fail, and the logs show messages about RADIUS timeouts.
-   **Cause**: The proxy cannot reach the RADIUS server over the network.
-   **Troubleshooting Steps**:
    1.  **Network Connectivity**: From the machine running `radius-proxy`, ensure you can reach the RADIUS server on the configured UDP port (default `1812`). Firewalls between the proxy and the RADIUS server are a common cause of this issue.
    2.  **Check RADIUS Server**: Ensure the RADIUS server is running and configured to accept requests from the IP address of the `radius-proxy` machine.
    3.  **Check Shared Secret**: Verify that the `RADIUS_SECRET` in your `config.toml` exactly matches the shared secret configured on your RADIUS server for the proxy client.
    4.  **Increase Timeout**: If you are on a slow or high-latency network, you may need to increase the `RADIUS_TIMEOUT` value in your configuration.

### 5. Team Synchronization is Not Working

-   **Symptom**: Users can log in, but they are not being added to their assigned teams in Grafana.
-   **Cause**: The proxy is failing to communicate with the Grafana API.
-   **Troubleshooting Steps**:
    1.  **Check the Proxy Logs**: Look for any errors related to the Grafana API client (`[grafana]`). The logs will show the status of the user lookup and team addition API calls.
    2.  **Verify `GRAFANA_BASE_URL`**: Ensure this is set to the correct public URL for your Grafana instance.
    3.  **Verify `GRAFANA_SA_TOKEN`**: Ensure the Service Account token is correct and has the required permissions (`users:read`, `teams:read`, `teams.write`).
    4.  **TLS Issues**: If your Grafana instance uses a self-signed certificate, you must set `GRAFANA_INSECURE_TLS = true`. Otherwise, the API calls will fail with a TLS error.
    5.  **Check `CLASS_MAP`**: Ensure the RADIUS `Class` attributes in your `CLASS_MAP` exactly match what the RADIUS server is sending, and that the team IDs are correct.
