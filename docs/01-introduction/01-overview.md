# Overview

**`radius-proxy`** is a specialized, high-performance authentication proxy designed to bridge the gap between modern applications that use OAuth 2.0 and OpenID Connect (OIDC) and traditional IT infrastructure that relies on the RADIUS protocol for authentication.

Its primary use case is to serve as a **Generic OAuth 2.0 Provider for Grafana**, enabling users to log into Grafana using their credentials from one or more RADIUS servers.

## The Problem

Grafana offers a flexible authentication system that supports various providers, including its own internal user database, LDAP, and several OAuth 2.0 providers like Google, GitHub, and Azure AD. For enterprise environments that have standardized on RADIUS for network and service access control, integrating Grafana can be challenging. Grafana does not have a built-in RADIUS authentication module, and has [no intention of adding one](https://github.com/grafana/grafana/pull/111708).

This creates a disconnect:

-   **Modern Application (Grafana):** Expects modern, token-based authentication flows like OAuth 2.0.
-   **Legacy Infrastructure (RADIUS):** Provides a robust, but older, challenge-response authentication mechanism based on shared secrets and UDP packets.

Without a bridge, administrators are forced to manage a separate user database for Grafana, defeating the purpose of a centralized authentication system.

## The Solution

`radius-proxy` acts as a sophisticated intermediary that speaks both languages:

1.  **To Grafana, it appears as a standard OAuth 2.0 and OIDC provider.** It exposes all the necessary endpoints that Grafana's "Generic OAuth" integration requires, including authorization, token exchange, and user information.

2.  **To the RADIUS infrastructure, it acts as a standard RADIUS client (Network Access Server).** When a user attempts to log in, the proxy constructs and sends a RADIUS `Access-Request` packet to the configured RADIUS server(s) and securely validates the user's credentials using the PAP (Password Authentication Protocol).

By doing so, it seamlessly translates Grafana's OAuth 2.0 login request into a RADIUS authentication sequence and returns the result in a format Grafana understands.

## Key Features

The application is built with performance, reliability, and security in mind, offering a rich set of features:

-   **Full OAuth 2.0 `authorization_code` Grant Flow**: Implements the standard, secure authorization code flow, complete with PKCE (Proof Key for Code Exchange) support for enhanced security.
-   **OpenID Connect (OIDC) Discovery**: Provides `/.well-known/openid-configuration` and `/.well-known/jwks.json` endpoints, allowing for automatic configuration and key discovery by OIDC-compliant clients like Grafana.
-   **RADIUS Authentication**: Securely authenticates users against one or more RADIUS servers using the PAP protocol.
-   **High-Availability RADIUS Failover**: Can be configured with multiple RADIUS servers. It performs periodic background health checks and will automatically fail over to a healthy server if the primary one becomes unresponsive, ensuring high availability.
-   **Dynamic Grafana Role Mapping**: Maps RADIUS `Class` attributes (or other configurable attributes) to Grafana roles. For example, a user with a specific RADIUS group can be automatically granted `GrafanaAdmin` privileges.
-   **Automatic Grafana Team Synchronization**: Automatically adds users to specific Grafana teams based on their RADIUS group memberships. This is achieved by mapping RADIUS `Class` attributes to Grafana Team IDs.
-   **Secure Token Generation**: Generates signed JSON Web Tokens (JWTs) for both ID Tokens and Access Tokens. It supports RSA (RS256) with automatic key generation and rotation, as well as HS256 for simpler setups.
-   **Extensive Configuration**: All operational parameters are managed through a single `config.toml` file, with support for environment variable overrides for easy deployment in containerized environments.
-   **Lightweight and Performant**: Built on Next.js and Bun, the application is lightweight and optimized for fast startup and low resource consumption.
-   **Easy Deployment**: Can be run as a standalone Node.js application or as a Docker container, with a provided `docker-compose.yml` for quick setup.
