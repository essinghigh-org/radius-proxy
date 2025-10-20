# Docker & Docker Compose Setup

`radius-proxy` is designed to be easily containerized and deployed with Docker. This guide covers how to use the provided `Dockerfile` and `docker-compose.yml` to run the application in a containerized environment.

## Prerequisites

-   **[Docker](https://docs.docker.com/get-docker/)**: The container runtime.
-   **[Docker Compose](https://docs.docker.com/compose/install/)**: For easily managing the application container and its configuration.

## Using the Pre-built Image with Docker Compose

The easiest way to get started is by using the pre-built container image from the GitHub Container Registry (`ghcr.io`) along with the `docker-compose.yml` file at the root of the repository.

### Step 1: Create a Configuration File

The Docker Compose setup is designed to mount a local configuration file into the container. You must create this file before starting the service.

1.  **Navigate to the repository root**:

    ```bash
    cd /path/to/radius-proxy
    ```

2.  **Create `config.toml`**:
    Create a file named `config.toml` in the root directory. This file will be mounted into the container at `/app/config.toml`.

    You can copy the example configuration from `radius-proxy/config.example.toml` as a starting point.

    ```bash
    cp radius-proxy/config.example.toml ./config.toml
    ```

3.  **Edit `config.toml`**:
    Modify `./config.toml` with your specific settings, such as RADIUS server details, OAuth credentials, and the `ISSUER` URL.

    **Important**: The `HTTP_HOST` in your `config.toml` should be set to `0.0.0.0` to allow the Next.js server inside the container to accept connections from the Docker network. The `HTTP_PORT` should match the internal port used by the application (default `54567`).

    ```toml
    # ./config.toml

    HTTP_HOST = "0.0.0.0"
    HTTP_PORT = 54567

    ISSUER = "http://auth.example.local:54567"

    RADIUS_HOSTS = ["10.10.1.5"]
    RADIUS_SECRET = "your-radius-secret"

    # ... other settings
    ```

### Step 2: Customize `docker-compose.yml`

The provided `docker-compose.yml` file uses environment variables to configure the container. You can set these directly in your shell or create a `.env` file in the same directory.

**`docker-compose.yml`:**
```yaml
version: '3.8'

services:
  radius-proxy:
    image: ghcr.io/essinghigh/radius-proxy:latest
    restart: unless-stopped
    ports:
      - "${HOST_PORT:-54567}:54567"
    environment:
      - NODE_ENV=production
      - ISSUER=http://auth.example.local:${HOST_PORT:-54567}
      # Add other environment variable overrides here if needed
    volumes:
      - type: bind
        source: ./config.toml
        target: /app/config.toml
        read_only: true
```

-   `HOST_PORT`: This variable determines the port on the host machine that will map to the container's port `54567`. If not set, it defaults to `54567`.
-   `ISSUER`: This should be set to the public URL of the proxy. It's important that this matches the `ISSUER` in your `config.toml` and is accessible by Grafana.

### Step 3: Run the Container

With your `config.toml` and `docker-compose.yml` in place, you can start the container.

```bash
# To run with a custom host port
export HOST_PORT=8080
docker compose up -d

# To run with the default port (54567)
docker compose up -d
```

The `-d` flag runs the container in detached mode. You can view the logs using:

```bash
docker compose logs -f
```

## Building the Docker Image Manually

If you need to build the image from source (for example, after making code changes), you can use the `Dockerfile` located in the `radius-proxy/` directory.

The `Dockerfile` uses a multi-stage build process:

1.  **`builder` stage**: Installs all dependencies (including `devDependencies`), and runs `bun run build` to create an optimized Next.js production build.
2.  **`runner` stage**: A smaller final image that installs only production dependencies and copies the build artifacts from the `builder` stage. This results in a lean and secure final image.

### Build Command

To build the image, run the following command from the root of the repository:

```bash
docker build -t my-radius-proxy:latest -f radius-proxy/Dockerfile .
```

-   `-t my-radius-proxy:latest`: Tags the built image with a name and tag of your choice.
-   `-f radius-proxy/Dockerfile`: Specifies the path to the Dockerfile.
-   `.`: Sets the build context to the root of the repository.

After building, you can update your `docker-compose.yml` to use your custom image:

```yaml
services:
  radius-proxy:
    image: my-radius-proxy:latest
    # ... rest of the configuration
```
