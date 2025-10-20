# Development Guide

This guide is for developers who want to contribute to `radius-proxy`, fix bugs, or add new features. It covers the development workflow, including running tests, linting, and understanding the project structure.

## Getting Started

Before you begin, please follow the **[Manual Installation](./01-installation.md)** guide to set up your local development environment, including cloning the repository, installing dependencies with `bun install`, and creating a `config.toml` file.

## Development Workflow

1.  **Run the Development Server**: Start the Next.js application in development mode.

    ```bash
    # from the radius-proxy/ directory
    bun run dev
    ```

    This command starts the server with hot-reloading, so any changes you make to the code will be automatically reflected in the running application.

2.  **Make Code Changes**: Modify the code in your preferred editor.

3.  **Verify Changes**: As you work, you should run the available checks to ensure your code is high-quality and does not introduce regressions.

## Running Tests

The project uses **Bun's built-in test runner** (`bun:test`) for integration testing. The tests cover the entire authentication and OIDC flow, from authorization code generation to token exchange and user info retrieval.

-   **Test Files**: Test files are located in the `tests/` directory and end with `.test.ts`.
-   **Mocks**: The tests mock the `radiusAuthenticate` function to simulate responses from a RADIUS server, allowing the tests to run without a live RADIUS connection.

To run the entire test suite, use the following command:

```bash
bun test
```

This command will execute all files in the `tests/` directory and report the results.

## Code Quality Tools

The project is configured with tools to enforce code style and type safety.

### Linting with ESLint

We use **ESLint** with the `next/core-web-vitals` configuration to enforce code style and catch common errors.

To run the linter, use the `lint` script:

```bash
bun run lint
```

This will check all relevant source files for linting errors.

### Type Checking with TypeScript

The entire codebase is written in **TypeScript** to ensure type safety.

To run the TypeScript compiler and check for any type errors, use the `typecheck` script:

```bash
bun run typecheck
```

This command runs `tsc --noEmit`, which performs a full type check of the project without generating any JavaScript files.

**It is highly recommended to run `bun test`, `bun run lint`, and `bun run typecheck` before submitting any changes.**

## Project Structure

-   `app/`: The Next.js `app` directory.
    -   `api/`: Contains all the server-side API route handlers, which form the core of the OAuth/OIDC provider.
    -   `page.tsx`: The main page component for the login UI.
-   `components/`: Contains the React components for the UI.
    -   `ui/`: Reusable UI components from `shadcn/ui`.
    -   `login-form.tsx`: The main login form component.
-   `lib/`: Contains the core business logic of the application.
    -   `config.ts`: Configuration loading and management.
    -   `radius.ts`: The low-level RADIUS client.
    -   `radius_hosts.ts`: RADIUS server failover and health check management.
    -   `jwt.ts`: JWT signing and verification.
    -   `storage.ts`: In-memory storage for OAuth codes and refresh tokens.
    -   `grafana.ts`: Helper for interacting with the Grafana API.
-   `tests/`: Contains all the integration tests.
-   `public/`: Static assets like images and logos.
-   `config.example.toml`: The example configuration file.
-   `Dockerfile`: For building the production Docker image.
