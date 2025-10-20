# Radius-Proxy Documentation

Welcome to the complete technical documentation for the Grafana RADIUS OAuth Proxy.

This documentation provides an in-depth look at the architecture, configuration, and deployment of the `radius-proxy` application. It is intended for administrators, developers, and anyone who needs to deploy, manage, or contribute to the project.

## Navigation

This documentation is organized into several sections, each covering a specific aspect of the application.

-   **[1. Introduction](./01-introduction/01-overview.md)**
    -   [Overview](./01-introduction/01-overview.md): A high-level summary of the project's purpose and functionality.
    -   [Architecture](./01-introduction/02-architecture.md): A detailed look at the technical architecture and core components.

-   **[2. Getting Started](./02-getting-started/01-installation.md)**
    -   [Installation](./02-getting-started/01-installation.md): Instructions for a manual setup for development or production.
    -   [Docker Setup](./02-getting-started/02-docker-setup.md): Guide for deploying the application using Docker and Docker Compose.

-   **[3. Configuration](./03-configuration/01-main-configuration.md)**
    -   [Main Configuration (`config.toml`)](./03-configuration/01-main-configuration.md): A comprehensive reference for every parameter in the configuration file.
    -   [Environment Variables](./03-configuration/02-environment-variables.md): Details on how to override `config.toml` settings using environment variables.

-   **[4. Features](./04-features/01-authentication-flow.md)**
    -   [Authentication Flow](./04-features/01-authentication-flow.md): A step-by-step breakdown of the OAuth 2.0 and RADIUS authentication process.
    -   [RADIUS Failover & Health Checks](./04-features/02-radius-failover.md): Explanation of the high-availability mechanism for RADIUS servers.
    -   [Grafana Integration](./04-features/03-grafana-integration.md): How the proxy integrates with Grafana for role and team synchronization.
    -   [Security](./04-features/04-security.md): An overview of the security measures implemented in the proxy.

-   **[5. API Reference](./05-api-reference/01-oauth-endpoints.md)**
    -   [OAuth 2.0 Endpoints](./05-api-reference/01-oauth-endpoints.md): Detailed documentation for the `/authorize` and `/token` endpoints.
    -   [OIDC & UserInfo Endpoints](./05-api-reference/02-oidc-discovery.md): Reference for the OIDC discovery and user information endpoints.

-   **[6. Guides](./06-guides/01-deployment.md)**
    -   [Deployment](./06-guides/01-deployment.md): Best practices for deploying the application in a production environment.
    -   [Development](./06-guides/02-development.md): A guide for developers who wish to contribute to the project.
    -   [Troubleshooting](./06-guides/03-troubleshooting.md): Solutions for common issues and debugging tips.
