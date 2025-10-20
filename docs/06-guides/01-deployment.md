# Deployment Guide

This guide provides recommendations and best practices for deploying the `radius-proxy` application in a production environment.

## Recommended Deployment Strategy: Docker

The most straightforward and recommended method for deploying `radius-proxy` is to use **Docker**. This approach encapsulates the application and its dependencies, providing a consistent and isolated runtime environment.

Refer to the **[Docker & Docker Compose Setup](./../02-getting-started/02-docker-setup.md)** guide for detailed instructions.

### Key Advantages of Using Docker:

-   **Consistency**: The container image includes the correct Node.js version and all necessary system dependencies.
-   **Isolation**: The application runs in its own environment, preventing conflicts with other services on the host.
-   **Scalability**: Container orchestrators like Kubernetes or Docker Swarm can be used to manage and scale the application.
-   **Immutability**: The container image is immutable. Configuration is supplied externally, aligning with modern DevOps practices.

## Configuration and Secret Management

In a production environment, you should **never** hardcode secrets or environment-specific settings into the `config.toml` file or the Docker image.

### Use Environment Variables

-   **The Golden Rule**: All configuration that varies between environments (development, staging, production) or contains sensitive information should be supplied via **environment variables**.
-   **Docker Compose**: When using `docker-compose`, you can place these variables in a `.env` file in the same directory as your `docker-compose.yml` file. This file should be excluded from version control.

    **Example `.env` file:**
    ```
    # .env
    HOST_PORT=54567

    # These will be passed to the container
    ISSUER=https://auth.mycompany.com
    OAUTH_CLIENT_SECRET=a-very-strong-and-random-secret
    RADIUS_SECRET=another-very-strong-secret
    GRAFANA_SA_TOKEN=glsa_...
    ```

-   **Kubernetes**: When deploying with Kubernetes, use `Secrets` for sensitive data like client secrets and RADIUS secrets, and `ConfigMaps` for non-sensitive configuration. Mount these as environment variables into the pod.

### Persisting Keys

-   The application automatically generates an RSA key pair for signing JWTs and stores it in the `/app/.keys` directory inside the container.
-   **To ensure that JWTs remain valid across container restarts, you must persist this directory.**
-   You can do this by mounting a Docker volume:

    ```yaml
    # In docker-compose.yml
    services:
      radius-proxy:
        # ... other settings
        volumes:
          - type: bind
            source: ./config.toml
            target: /app/config.toml
            read_only: true
          - type: volume
            source: radius-proxy-keys
            target: /app/.keys

    volumes:
      radius-proxy-keys: {}
    ```

## Running Behind a Reverse Proxy

It is critical to run `radius-proxy` behind a reverse proxy like **Nginx**, **Caddy**, or **Traefik** in production. The built-in Next.js server is not hardened for direct exposure to the internet.

### Responsibilities of the Reverse Proxy:

1.  **TLS/SSL Termination**: The reverse proxy should handle all HTTPS traffic, terminating the TLS connection and forwarding requests to the `radius-proxy` over plain HTTP. This offloads the complexity of certificate management from the application.
2.  **Host and Protocol Headers**: The reverse proxy must be configured to pass the correct `X-Forwarded-Host` and `X-Forwarded-Proto` headers to the proxy. `radius-proxy` uses these headers to construct correct `issuer` and redirect URLs.
3.  **Path Routing**: The reverse proxy should route all traffic for the designated public path (e.g., `/radius_login`) to the `radius-proxy` container.

### Example Nginx Configuration

This example assumes `radius-proxy` is running on the same host and listening on port `54567`.

```nginx
server {
    listen 443 ssl http2;
    server_name auth.mycompany.com;

    # TLS Configuration
    ssl_certificate /etc/nginx/certs/auth.mycompany.com.crt;
    ssl_certificate_key /etc/nginx/certs/auth.mycompany.com.key;

    location /radius_login/ {
        proxy_pass http://127.0.0.1:54567/radius_login/;

        # Set headers for the backend
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        # WebSocket support for Next.js
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## High Availability

-   **RADIUS Server HA**: The proxy has built-in support for RADIUS high availability through the `RADIUS_HOSTS` array and the failover mechanism. Ensure you list multiple RADIUS servers in your configuration.
-   **Proxy HA**: To make the `radius-proxy` itself highly available, you can run multiple instances of the container behind a load balancer. Since the application is mostly stateless (short-lived codes are in memory), this works well. However, be aware of the following:
    -   **In-Memory Storage**: If you run multiple instances, an authorization code generated by one instance will not be available on another. The time window for this to be an issue is very short (the time between user login and Grafana exchanging the code). For most use cases, this is an acceptable risk. If absolute session consistency is required, the storage backend would need to be moved to a shared service like Redis (which would require code modification).
    -   **Key Consistency**: All instances must use the same JWT signing keys. Ensure the Docker volume for the `.keys` directory is shared or that the keys are pre-provisioned as environment variables or secrets to all instances.
