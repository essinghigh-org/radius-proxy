# API Reference: OAuth 2.0 Endpoints

This document provides a detailed technical reference for the core OAuth 2.0 endpoints implemented by `radius-proxy`.

## Authorization Endpoint

The authorization endpoint is the entry point for the OAuth 2.0 flow. It handles the initial request from the client (Grafana) and the user's credential submission.

-   **Endpoint**: `/api/oauth/authorize`
-   **Code Reference**: `app/api/oauth/authorize/route.ts`

### `GET /api/oauth/authorize`

This method is used by the client to initiate the login flow by redirecting the user to the proxy.

#### Request Parameters (Query String)

| Parameter               | Type     | Required | Description                                                                                                                                |
| ----------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `response_type`         | `String` | Yes      | Must be `"code"`.                                                                                                                        |
| `client_id`             | `String` | Yes      | The client ID of the application (e.g., `"grafana"`). Must match `OAUTH_CLIENT_ID` in the config.                                            |
| `redirect_uri`          | `String` | Yes      | The URL to which the user will be redirected after authentication. Must be in the `REDIRECT_URIS` allowlist.                               |
| `state`                 | `String` | No       | An opaque value used by the client to maintain state and prevent CSRF attacks. The proxy will include this value in the redirect back to the client. |
| `code_challenge`        | `String` | No       | The code challenge for PKCE (RFC 7636).                                                                                                    |
| `code_challenge_method` | `String` | No       | The method used to derive the challenge. Supported values are `"S256"` and `"plain"`. Defaults to `"plain"` if `code_challenge` is present. |

#### Responses

-   **`302 Found` (Success)**: Redirects the user to the login page (`/radius_login`), preserving all the original query parameters.
-   **`400 Bad Request` (Failure)**: If required parameters like `client_id` or `redirect_uri` are missing. Returns a JSON object: `{"error": "invalid_request"}`.
-   **`401 Unauthorized` (Failure)**: If the `client_id` does not match the configured `OAUTH_CLIENT_ID`. Returns `{"error": "unauthorized_client"}`.

### `POST /api/oauth/authorize`

This method is used by the proxy's own login form to submit the user's credentials for authentication.

#### Request Body (`application/x-www-form-urlencoded`)

| Parameter      | Type     | Required | Description |
| -------------- | -------- | -------- | ----------- |
| `user`         | `String` | Yes      | The user's RADIUS username. |
| `password`     | `String` | Yes      | The user's RADIUS password. |
| `client_id`    | `String` | Yes      | The client ID (passed through from the initial `GET` request). |
| `redirect_uri` | `String` | Yes      | The redirect URI (passed through from the initial `GET` request). |
| `state`        | `String` | No       | The state value (passed through from the initial `GET` request). |

#### Responses

-   **`302 Found` (Success)**: On successful RADIUS authentication, the user is redirected to the `redirect_uri` with the `code` and `state` parameters in the query string.
-   **`302 Found` (Failure)**: On any failure (invalid credentials, user not permitted, etc.), the user is redirected to the login page (`/radius_login`) with `error` and `error_description` parameters in the query string.
-   **`400 Bad Request` / `401 Unauthorized` (JSON response)**: If the form submission includes `accept=json`, the endpoint will return a JSON error object instead of a redirect.

---

## Token Endpoint

The token endpoint is used by the client to exchange an authorization code or a refresh token for an access token.

-   **Endpoint**: `/api/oauth/token`
-   **Code Reference**: `app/api/oauth/token/route.ts`

### `POST /api/oauth/token`

#### Client Authentication

The client must authenticate itself using one of two methods:

1.  **HTTP Basic Authentication**: The `client_id` and `client_secret` are sent in the `Authorization` header, Base64-encoded.
    -   `Authorization: Basic <base64(client_id:client_secret)>`
2.  **Request Body**: The `client_id` and `client_secret` are included in the `POST` body.

#### Grant Type: `authorization_code`

This is used to exchange a one-time authorization code for tokens.

##### Request Body (`application/x-www-form-urlencoded`)

| Parameter       | Type     | Required | Description                                                                                             |
| --------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `grant_type`    | `String` | Yes      | Must be `"authorization_code"`.                                                                         |
| `code`          | `String` | Yes      | The authorization code received from the `/authorize` endpoint.                                       |
| `redirect_uri`  | `String` | Yes      | The same redirect URI that was used in the initial authorization request. (Required by spec, but not strictly validated by this proxy). |
| `code_verifier` | `String` | No       | The PKCE code verifier, required if a `code_challenge` was used in the authorization request.         |

##### Success Response (`200 OK`)

A JSON object containing the tokens:

```json
{
  "access_token": "...",
  "token_type": "bearer",
  "expires_in": 3600,
  "id_token": "...",
  "refresh_token": "...",
  "scope": "openid profile"
}
```

##### Error Responses

-   **`400 Bad Request`**: If the code is invalid, expired, or already used. Returns `{"error": "invalid_grant"}`.
-   **`401 Unauthorized`**: If the client credentials (`client_id` or `client_secret`) are invalid. Returns `{"error": "invalid_client"}`.

#### Grant Type: `refresh_token`

This is used to obtain a new access token using a refresh token.

##### Request Body (`application/x-www-form-urlencoded`)

| Parameter       | Type     | Required | Description                               |
| --------------- | -------- | -------- | ----------------------------------------- |
| `grant_type`    | `String` | Yes      | Must be `"refresh_token"`.                |
| `refresh_token` | `String` | Yes      | The refresh token from a previous exchange. |

##### Success Response (`200 OK`)

A JSON object containing the new tokens. Note that a new, rotated refresh token is also issued.

```json
{
  "access_token": "...",
  "token_type": "bearer",
  "expires_in": 3600,
  "id_token": "...",
  "refresh_token": "...", // A new refresh token
  "scope": "openid profile"
}
```

##### Error Responses

-   **`400 Bad Request`**: If the refresh token is invalid, expired, or was not found. Returns `{"error": "invalid_grant"}`.
-   **`401 Unauthorized`**: If the client credentials are invalid. Returns `{"error": "invalid_client"}`.
