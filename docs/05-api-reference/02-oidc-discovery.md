# API Reference: OIDC & UserInfo Endpoints

This document provides a reference for the OpenID Connect (OIDC) discovery endpoints and the UserInfo endpoints, which are essential for client configuration and retrieving user information.

## OIDC Discovery Endpoint

This endpoint allows OIDC-compliant clients like Grafana to automatically discover the configuration of the `radius-proxy`, including the locations of all other required endpoints and the supported capabilities.

-   **Endpoint**: `/.well-known/openid-configuration`
-   **Method**: `GET`
-   **Code Reference**: `app/api/.well-known/openid-configuration/route.ts`

### Description

When a client queries this endpoint, it receives a JSON document containing key metadata about the provider. The `ISSUER` URL is dynamically constructed to respect reverse proxy headers (`X-Forwarded-Proto`, `X-Forwarded-Host`), ensuring the advertised URLs are correct from an external perspective.

### Success Response (`200 OK`)

A JSON object with the following structure:

```json
{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/radius_login/api/oauth/authorize",
  "token_endpoint": "https://auth.example.com/radius_login/api/oauth/token",
  "userinfo_endpoint": "https://auth.example.com/radius_login/api/oauth/userinfo",
  "jwks_uri": "https://auth.example.com/radius_login/api/.well-known/jwks.json",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "scopes_supported": ["openid", "profile", "email"],
  "claims_supported": ["sub", "name", "email", "role"]
}
```

---

## JWKS Endpoint

The JSON Web Key Set (JWKS) endpoint provides the public key(s) that clients can use to verify the signature of the JWTs (ID Tokens) issued by the proxy. This is a critical part of the OIDC flow, allowing the client to trust the identity information in the token.

-   **Endpoint**: `/.well-known/jwks.json`
-   **Method**: `GET`
-   **Code Reference**: `app/api/.well-known/jwks.json/route.ts`

### Description

This endpoint exposes the public part of the RSA key pair used for signing tokens. If the proxy is configured to use HS256 (symmetric signing), this endpoint will return an empty set of keys.

The `kid` (Key ID) in the JWK is a SHA256 hash of the public key, which matches the `kid` found in the header of the JWTs.

### Success Response (`200 OK`)

A JSON object containing a list of JSON Web Keys (JWKs).

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "...",
      "e": "AQAB",
      "kid": "...",
      "use": "sig"
    }
  ]
}
```

-   If using HS256, the response will be `{"keys": []}`.

---

## UserInfo Endpoint

This endpoint returns claims about the authenticated user. It is protected and requires a valid `access_token` to be sent in the `Authorization` header.

-   **Endpoint**: `/api/oauth/userinfo`
-   **Method**: `GET`
-   **Code Reference**: `app/api/oauth/userinfo/route.ts`

### Request

-   **Header**: `Authorization: Bearer <access_token>`

### Success Response (`200 OK`)

A JSON object containing a subset of the user's claims.

```json
{
  "sub": "jdoe",
  "name": "jdoe",
  "groups": ["finance-team", "vpn-users"],
  "role": "GrafanaAdmin"
}
```

| Claim    | Type               | Description                                                                                             |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| `sub`    | `String`           | The user's unique identifier (their RADIUS username).                                                  |
| `name`   | `String`           | The user's display name (also their RADIUS username).                                                  |
| `groups` | `Array of Strings` | The list of groups the user belongs to, derived from the RADIUS `Class` attribute.                      |
| `role`   | `String`           | The user's Grafana role (e.g., `"GrafanaAdmin"`), present if they belong to a group in `ADMIN_CLASSES`. |

### Error Responses

-   **`401 Unauthorized`**: If the `access_token` is missing, invalid, or expired. Returns `{"error": "invalid_token"}` or `{"error": "invalid_request"}`.

## UserInfo Emails Endpoint

Some Grafana configurations require a separate endpoint to fetch the user's email address.

-   **Endpoint**: `/api/oauth/userinfo/emails`
-   **Method**: `GET`
-   **Code Reference**: `app/api/oauth/userinfo/emails/route.ts`

### Request

-   **Header**: `Authorization: Bearer <access_token>`

### Success Response (`200 OK`)

A JSON array containing the user's email information. The email is synthesized from the user's `sub` claim and the configured `EMAIL_SUFFIX`.

```json
[
  {
    "email": "jdoe@example.local",
    "primary": true
  }
]
```

### Error Responses

-   **`401 Unauthorized`**: If the `access_token` is missing, invalid, or expired. Returns `{"error": "invalid_token"}` or `{"error": "invalid_request"}`.
