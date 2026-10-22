# Environment variables

Every setting in the [main configuration reference](01-main-configuration.md) has an environment variable with the same name. Nonempty environment values override the file. Use numbers as decimal strings and booleans as `true` or `false`.

List values use comma-separated strings (RADIUS_HOSTS also accepts whitespace). REDIRECT_URIS and RADIUS_HOSTS also accept JSON arrays. CLASS_MAP accepts a JSON object, for example:

```sh
CLASS_MAP='{"grafana_users":[2,6],"operators":[9]}'
REDIRECT_URIS='https://grafana.example.com/login/generic_oauth'
```

Environment-only options:

| Variable | Meaning |
| --- | --- |
| `JWT_PRIVATE_KEY` | PEM RSA private key. Supply together with JWT_PUBLIC_KEY. |
| `JWT_PUBLIC_KEY` | Matching PEM RSA public key. |
| `JWT_HS256_SECRET` | Explicit HMAC signing secret of at least 32 bytes. Takes priority over RSA; JWKS is empty with HS256. |
| `NODE_ENV` | Use `production` for deployments. Bun's test runner sets `test`; never use that mode for a live deployment. |
| `DEBUG` | Enable debug logging. |
| `LOG_LEVEL` | Console level: error, warn, info or debug. |
| `FORCE_FILE_LOGS` | Enable file logging in production. Protect and rotate the log directory. |

Without supplied keys, RSA keys are generated in `.keys/`. That directory must be writable by the application user and persisted across restarts. Legacy disk HMAC files are not loaded automatically. Key changes require a restart.

Never commit real secrets or include them in a container build context.
