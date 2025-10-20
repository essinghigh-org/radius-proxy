# Manual Installation

This guide provides step-by-step instructions for setting up and running `radius-proxy` manually from the source code. This approach is suitable for development, testing, or production deployments where Docker is not used.

## Prerequisites

Before you begin, ensure you have the following software installed on your system:

-   **[Bun](https://bun.sh/)**: The application uses Bun as its JavaScript runtime and package manager. It is required for installing dependencies and running the application.
-   **[Git](https://git-scm.com/)**: For cloning the source code repository.
-   **A RADIUS Server**: You need access to a configured RADIUS server that the proxy can communicate with.

## Step 1: Clone the Repository

First, clone the `radius-proxy` repository to your local machine using Git.

```bash
git clone https://github.com/essinghigh/radius-proxy.git
cd radius-proxy
```

## Step 2: Install Dependencies

The project is located in the `radius-proxy/` subdirectory. Navigate into it and use Bun to install the required Node.js dependencies as defined in `package.json`.

```bash
cd radius-proxy
bun install
```

This command will read the `package.json` file and install all necessary libraries (like Next.js, React, and jsonwebtoken) into the `node_modules` directory.

## Step 3: Configure the Application

The application is configured via a TOML file. A detailed example file, `config.example.toml`, is provided in the `radius-proxy/` directory.

1.  **Create a Configuration File**:
    You can either modify `config.example.toml` directly or, for a cleaner setup, create your own `config.toml` file. The application will always prefer `config.toml` if it exists.

    ```bash
    cp config.example.toml config.toml
    ```

2.  **Edit the Configuration**:
    Open `config.toml` in a text editor and modify the parameters to match your environment. At a minimum, you must configure the following:

    -   `RADIUS_HOSTS`: An array of your RADIUS server IP addresses or hostnames.
    -   `RADIUS_SECRET`: The shared secret for your RADIUS server(s).
    -   `OAUTH_CLIENT_ID`: The Client ID for the OAuth application (e.g., `grafana`).
    -   `OAUTH_CLIENT_SECRET`: The Client Secret for the OAuth application.
    -   `REDIRECT_URIS`: An array of allowed redirect URIs for your Grafana instance. This must exactly match the URI Grafana will use, e.g., `["https://grafana.yourcompany.com/login/generic_oauth"]`.
    -   `ISSUER`: The public-facing URL of the `radius-proxy` itself, e.g., `https://auth.yourcompany.com`.

    For a complete reference of all available parameters, see the **[Main Configuration](./../03-configuration/01-main-configuration.md)** guide.

    **Example `config.toml`:**
    ```toml
    # OAuth client credentials
    OAUTH_CLIENT_ID = "grafana"
    OAUTH_CLIENT_SECRET = "your-grafana-client-secret"
    REDIRECT_URIS = ["https://grafana.example.com/login/generic_oauth"]

    # RADIUS servers
    RADIUS_HOSTS = ["10.10.1.5", "10.10.1.6"]
    RADIUS_SECRET = "your-radius-shared-secret"

    # Public URL of this proxy
    ISSUER = "https://auth.example.com"

    # User configuration
    EMAIL_SUFFIX = "example.com"
    PERMITTED_CLASSES = "grafana-users,grafana-admins"
    ADMIN_CLASSES = "grafana-admins"
    ```

## Step 4: Run the Application

Once the dependencies are installed and the configuration is in place, you can start the application.

### For Development

Use the `dev` script to run the Next.js application in development mode. This mode includes features like hot-reloading.

```bash
bun run dev
```

By default, the server will start on port `54567`. You can access it at `http://localhost:54567`.

### For Production

For a production deployment, you should first build the optimized application and then start it.

1.  **Build the Application**:
    This command compiles the Next.js application for production.

    ```bash
    bun run build
    ```

2.  **Start the Server**:
    This command runs the optimized production server.

    ```bash
    bun run start
    ```

The server will start on port `54567` by default. It is recommended to run the production server behind a reverse proxy like Nginx or Caddy to handle HTTPS, custom domains, and provide an additional layer of security.

## Step 5: Configure Grafana

Finally, configure Grafana to use `radius-proxy` as its OAuth 2.0 provider. In your `grafana.ini` file, add a section for Generic OAuth like the one below, adjusting the URLs and credentials to match your setup.

```ini
[auth.generic_oauth]
enabled = true
name = RADIUS
allow_sign_up = true
client_id = your-grafana-client-secret
client_secret = your-grafana-client-secret
scopes = openid profile email
auth_url = https://auth.example.com/radius_login/api/oauth/authorize
token_url = https://auth.example.com/radius_login/api/oauth/token
api_url = https://auth.example.com/radius_login/api/oauth/userinfo
role_attribute_path = role == 'GrafanaAdmin' && 'Admin' || 'Viewer'
```

You can also configure this in Grafana's [SSO settings UI](https://grafana.com/whats-new/2024-02-26-sso-settings-ui-and-terraform-resource-for-configuring-oauth-providers/)

After restarting Grafana, you should see a "Login with RADIUS" button on the login page.
