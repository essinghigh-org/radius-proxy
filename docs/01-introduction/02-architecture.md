# Technical Architecture

`radius-proxy` is a [Next.js](https://nextjs.org/) application that leverages its server-side API routes to function as a self-contained OAuth 2.0 and OIDC provider. The architecture is designed to be stateless where possible, relying on a robust configuration system and in-memory storage for short-lived data.

## High-Level Data Flow

A typical authentication sequence involves the following steps:

1.  **Initiation**: A user in Grafana clicks the "Login with OAuth" button. Grafana, configured to use `radius-proxy`, redirects the user to the proxy's `/api/oauth/authorize` endpoint.
2.  **Login UI**: The proxy presents a login form to the user.
3.  **Credential Submission**: The user submits their username and password to the `/api/oauth/authorize` endpoint via a POST request.
4.  **RADIUS Authentication**: The proxy, acting as a RADIUS client, sends an `Access-Request` to the active RADIUS server. This is handled by the `lib/radius_hosts.ts` manager, which ensures a healthy server is chosen.
5.  **Authorization Code**: Upon successful RADIUS authentication, the proxy generates a short-lived, one-time authorization code and stores it in memory. It then redirects the user back to Grafana with this code.
6.  **Token Exchange**: Grafana, in a back-channel request, sends the authorization code to the proxy's `/api/oauth/token` endpoint.
7.  **Token Issuance**: The proxy validates the code, and if valid, generates and signs a JWT-based `id_token` and `access_token`. It returns these tokens to Grafana.
8.  **Grafana Login**: Grafana validates the JWTs, extracts user information (like username, email, and role) from the claims, and logs the user in.
9.  **Team Sync (Optional)**: After issuing the tokens, the proxy can make an API call to Grafana to automatically add the user to predefined teams based on their RADIUS attributes.

## Core Components

The application is composed of several key modules found in the `radius-proxy/lib/` directory.

### 1. Configuration (`lib/config.ts`)

The configuration manager is the heart of the application, responsible for loading, parsing, and providing access to all operational parameters.

-   **Source**: It reads settings from `config.toml` or `config.example.toml`.
-   **Overrides**: Any setting can be overridden by a corresponding environment variable (e.g., `RADIUS_HOST` overrides the `RADIUS_HOST` key in the file).
-   **Dynamic Reloading**: It uses a file watcher to monitor the configuration file for changes. If the file is updated, the configuration is automatically reloaded at runtime without requiring a server restart. This allows for dynamic changes to RADIUS servers, client secrets, and other parameters.
-   **Type Safety**: It parses values into their correct types (numbers, booleans, arrays) with safe fallbacks.

### 2. RADIUS Client (`lib/radius.ts`)

This module contains the low-level logic for communicating with a RADIUS server.

-   **Protocol**: It implements a minimal RADIUS client over UDP.
-   **Packet Construction**: It builds `Access-Request` packets, properly encoding attributes like `User-Name` and `User-Password` (using PAP with MD5 hashing as per RFC 2865).
-   **Response Parsing**: It parses `Access-Accept` and `Access-Reject` responses, and is capable of extracting the `Class` attribute (or other configured attributes) which is used for role and team mapping.
-   **Security**: It includes logic to verify the response authenticator to protect against spoofed RADIUS replies.

### 3. RADIUS Host Manager (`lib/radius_hosts.ts`)

This is a critical component for ensuring the reliability of the authentication service.

-   **Host Pool**: It maintains an ordered list of RADIUS servers from the configuration (`RADIUS_HOSTS`).
-   **Active Host Selection**: It maintains a single "active" host to which all authentication requests are sent.
-   **Health Checks**: In the background, it periodically sends dummy `Access-Request` packets to all configured hosts to check their liveness. This is done via `setInterval`.
-   **Automatic Failover**: If an authentication request to the active host times out, or if a background health check fails, the manager triggers a failover sequence. It iterates through the remaining hosts in priority order until a responsive one is found, which is then promoted to be the new active host.

### 4. Storage Backend (`lib/storage.ts`)

The proxy uses a simple, in-memory storage system for data that only needs to persist for a short duration.

-   **In-Memory**: It uses a global object (`global._oauth_codes`) to store authorization codes and refresh tokens. This avoids the need for an external database, simplifying deployment.
-   **Data Stored**:
    -   **Authorization Codes**: Stores the code along with the user's details (username, groups, scope) and an expiry timestamp.
    -   **Refresh Tokens**: Stores refresh tokens with user details, allowing for persistent sessions.
-   **Cleanup**: It includes a cleanup mechanism to periodically iterate through the stored data and remove expired entries, preventing memory leaks.

### 5. JWT Manager (`lib/jwt.ts`)

This module is responsible for all cryptographic operations related to JSON Web Tokens (JWTs).

-   **Key Generation**: On startup, it automatically generates a 2048-bit RSA key pair and saves it to the `.keys/` directory. This ensures that signed tokens remain valid across server restarts.
-   **Algorithm Support**: It defaults to `RS256` for asymmetric signing. For simpler deployments or testing, it can be configured to use `HS256` with a shared secret.
-   **Signing**: It creates and signs `id_token` and `access_token` JWTs with the appropriate claims (e.g., `sub`, `iss`, `aud`, `exp`, `email`, `groups`, `role`).
-   **Verification**: It provides a function to verify the signature and validity of incoming access tokens, used by the `/userinfo` endpoint.

### 6. Grafana API Client (`lib/grafana.ts`)

This small utility handles communication with the Grafana API for team synchronization.

-   **API Calls**: It makes POST requests to Grafana's `/api/teams/{teamId}/members` endpoint.
-   **User Lookup**: Before adding a user to a team, it first looks up the user's Grafana ID by their email address. It includes a retry mechanism to handle the delay between a user's first login and their account being provisioned in Grafana.
-   **Idempotency**: It checks if a user is already a member of a team before attempting to add them, preventing redundant API calls.

## API Endpoints (`app/api/`)

The public-facing interface of the proxy is defined by a set of API routes.

-   `/api/oauth/authorize`: Handles both the initial GET request from Grafana and the POST request from the login form.
-   `/api/oauth/token`: Exchanges authorization codes and refresh tokens for JWTs.
-   `/api/oauth/userinfo`: Returns user claims from a valid access token.
-   `/api/.well-known/openid-configuration`: The OIDC discovery endpoint.
-   `/api/.well-known/jwks.json`: The OIDC JSON Web Key Set (JWKS) endpoint for public key distribution.

## Frontend (`components/` and `app/page.tsx`)

The user-facing part of the application is a simple Next.js page with a React Server Component (`page.tsx`) that renders a client-side login form (`login-form.tsx`). The form is styled using [shadcn/ui](https://ui.shadcn.com/) and [Tailwind CSS](https://tailwindcss.com/).
