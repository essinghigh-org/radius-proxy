# Security

`radius-proxy` is designed with security as a primary consideration. This document outlines the key security measures implemented to protect the authentication flow, the application itself, and the users.

## Transport Layer Security

It is strongly recommended to run `radius-proxy` behind a reverse proxy (like Nginx or Caddy) that provides TLS (HTTPS) termination. This ensures that all communication between the user's browser, Grafana, and the proxy is encrypted.

## OAuth 2.0 and OIDC Security

### PKCE (Proof Key for Code Exchange)

-   **What it is**: PKCE (RFC 7636) is an extension to the Authorization Code flow that mitigates the threat of authorization code interception.
-   **Implementation**: `radius-proxy` fully supports PKCE. When Grafana (or another client) initiates a login with a `code_challenge` and `code_challenge_method`, the proxy stores these values along with the authorization code. During the token exchange, the client must provide a `code_verifier`. The proxy then validates the verifier against the stored challenge.
-   **Benefit**: This ensures that even if an authorization code is stolen, it is useless without the corresponding `code_verifier`, preventing attackers from exchanging it for a token.
-   **Code Reference**: `app/api/oauth/authorize/route.ts` (stores the challenge) and `app/api/oauth/token/route.ts` (verifies the code).

### Strict Redirect URI Validation

-   **What it is**: Open redirect is a vulnerability where an attacker can use a legitimate application to redirect users to a malicious site. In OAuth 2.0, this can be used in phishing attacks.
-   **Implementation**: The proxy enforces a strict allowlist for redirect URIs. The `redirect_uri` provided by the client during the authorization request **must exactly match** one of the URIs in the `REDIRECT_URIS` configuration array.
-   **Benefit**: This prevents attackers from tricking the proxy into redirecting users with a valid authorization code to a server they control.
-   **Code Reference**: `app/api/oauth/authorize/route.ts` (`POST` handler).

### State Parameter

-   **What it is**: The `state` parameter is used to protect against Cross-Site Request Forgery (CSRF) attacks.
-   **Implementation**: The proxy correctly echoes back the `state` parameter provided by the client in the authorization request to the final redirect. It is the client's (Grafana's) responsibility to generate a unique `state` value and validate that it matches upon receiving the callback.

## JWT (JSON Web Token) Security

### Strong Signing Algorithms

-   **Default**: The proxy defaults to using **RS256** (RSA with SHA-256) for signing JWTs. This is an asymmetric algorithm, meaning it uses a private key to sign tokens and a public key to verify them.
-   **Benefit**: This is highly secure, as the private key never leaves the server. The public key can be safely distributed via the `/jwks.json` endpoint for clients like Grafana to use for verification.
-   **Key Management**: The proxy automatically generates a 2048-bit RSA key pair on first startup and stores it in the `.keys/` directory. This directory should be protected and persisted across deployments.
-   **Alternative**: For simpler setups, `HS256` (HMAC with SHA-256) is supported via the `JWT_HS256_SECRET` environment variable. This is a symmetric algorithm and is less secure if the secret is compromised.
-   **Code Reference**: `lib/jwt.ts`.

### Token Expiration

-   **Access Tokens**: Are short-lived (default: 1 hour) to limit the window of opportunity for an attacker if a token is compromised.
-   **ID Tokens**: Also short-lived (default: 1 hour).
-   **Refresh Tokens**: Are long-lived (default: 90 days) but can only be used to obtain new access tokens and are stored securely by the proxy.
-   **Authorization Codes**: Are extremely short-lived (default: 10 minutes) and are single-use.

## Application Security

### HTTP Security Headers

To protect against common web vulnerabilities, the proxy adds several security headers to its HTTP responses, particularly for user-facing pages.

-   `Content-Security-Policy`: Set to `default-src 'self'` to prevent cross-site scripting (XSS) by restricting where content can be loaded from.
-   `X-Content-Type-Options`: Set to `nosniff` to prevent the browser from MIME-sniffing a response away from the declared content-type.
-   `X-Frame-Options`: Set to `DENY` to prevent the login page from being embedded in an `<iframe>`, mitigating clickjacking attacks.
-   `Referrer-Policy`: Set to `strict-origin-when-cross-origin` to control how much referrer information is sent in requests.
-   `X-XSS-Protection`: Set to `1; mode=block` to enable the browser's built-in XSS filter.

-   **Code Reference**: `addSecurityHeaders` function in `app/api/oauth/authorize/route.ts`.

### Filesystem and Secret Management

-   **Key Storage**: RSA keys and HMAC secrets are stored in the `.keys/` directory. This directory is included in `.gitignore` to prevent accidental check-in of secrets to version control.
-   **Configuration**: The main `config.toml` file is also ignored by Git. The recommended practice for production is to use environment variables for all secrets.

## RADIUS Security

-   **Shared Secret**: All communication with the RADIUS server is protected by a shared secret, which is used to encrypt password attributes and validate response authenticators.
-   **Response Authenticator Validation**: The proxy validates the `Response-Authenticator` field in RADIUS responses to ensure they originate from a legitimate RADIUS server that knows the shared secret, protecting against UDP source address spoofing.
-   **Code Reference**: `lib/radius.ts`.
