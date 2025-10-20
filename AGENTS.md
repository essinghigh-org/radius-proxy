# Agent Instructions for `radius-proxy`

This document provides a concise overview for AI agents working on the `radius-proxy` codebase.

## Project Purpose

This is a Next.js application that functions as an OAuth 2.0 and OpenID Connect (OIDC) proxy for Grafana. It enables users to authenticate against one or more RADIUS servers and then uses the authentication details to grant access to Grafana via its Generic OAuth integration.

The application provides a simple login interface, handles the full OAuth `authorization_code` grant flow, and issues JWTs that Grafana can consume.

## Core Functionality

-   **OAuth 2.0 / OIDC Provider**: Implements the necessary endpoints for an authorization code grant flow (`/authorize`, `/token`, `/userinfo`) and OIDC discovery (`/.well-known/openid-configuration`, `/.well-known/jwks.json`).
-   **RADIUS Authentication**: Authenticates users against RADIUS servers using the PAP protocol.
-   **RADIUS Failover & Health Checks**: Manages a list of RADIUS servers, performs periodic health checks, and automatically fails over to a healthy server if the active one becomes unresponsive.
-   **Grafana Integration**:
    -   Generates JWTs (ID and Access Tokens) with claims (`sub`, `name`, `email`, `groups`, `role`) that Grafana can use.
    -   Maps RADIUS `Class` attributes to Grafana roles (e.g., `GrafanaAdmin`) and team memberships.
    -   Can automatically add users to Grafana teams based on their RADIUS group.
-   **Configuration**: All operational parameters are managed via a central `config.toml` file, with support for environment variable overrides.

## Key Files and Modules

-   `config.example.toml`: **The most important file for understanding configuration.** It documents all available settings, from RADIUS servers and OAuth credentials to Grafana integration parameters. The application loads `config.toml` if it exists, otherwise it falls back to this example file.
-   `lib/config.ts`: Handles loading, parsing, and providing access to the configuration from `config.toml` and environment variables. It includes a file watcher to reload the configuration at runtime.
-   `lib/radius.ts`: The core RADIUS client. It constructs and sends `Access-Request` packets and parses responses.
-   `lib/radius_hosts.ts`: Manages the pool of RADIUS servers. It handles the failover logic and background health checks. This is a critical component for the service's reliability.
-   `lib/storage.ts`: A simple, in-memory storage backend for OAuth authorization codes and refresh tokens.
-   `lib/jwt.ts`: Manages the creation and signing of JSON Web Tokens (JWTs). It automatically generates and manages RSA keys (or uses an HS256 secret) for signing.
-   `lib/grafana.ts`: Contains helper functions for interacting with the Grafana API, specifically for adding users to teams.
-   `app/api/oauth/authorize/route.ts`: The OAuth authorization endpoint. It presents the login UI, receives user credentials, calls the RADIUS client via `lib/radius.ts`, and issues a one-time authorization code.
-   `app/api/oauth/token/route.ts`: The OAuth token endpoint. It exchanges a valid authorization code or refresh token for a set of JWTs.
-   `components/login-form.tsx`: The React component for the user-facing login form.
-   `package.json`: Defines dependencies and scripts. Key scripts are `dev` (starts the development server), `build`, `start`, and `lint`.
-   `tests/auth.test.ts`: Contains `bun:test` integration tests for the complete authentication and OIDC flow.

## Development Workflow

1.  **Configuration**: Before running, review `config.example.toml` to understand the required settings. For development, you can either create a `config.toml` or modify the example file directly.
2.  **Running the App**: Use `bun run dev` to start the Next.js development server.
3.  **Testing**: Run `bun test` to execute the test suite. The tests in `tests/auth.test.ts` cover the main authentication logic and are a good reference for the expected behavior of the API endpoints.
