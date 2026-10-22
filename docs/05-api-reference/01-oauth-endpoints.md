# OAuth endpoints

The canonical prefix is `/radius_login/api/oauth`. `/api/oauth` is also supported. POSTs accept URL-encoded forms or multipart forms up to 16 KiB, with unique string fields.

## GET /authorize

Requires `client_id` and an exact registered `redirect_uri`. `response_type`, when provided, must be `code`. Optional fields are `state`, `scope`, `nonce`, `code_challenge` and `code_challenge_method`.

PKCE accepts S256 only, with a 43-character base64url SHA-256 challenge. The challenge and method must be supplied together. Supported scopes are `openid`, `profile` and `email`; the default is `openid profile`.

A valid request redirects to `/radius_login` with the OAuth parameters preserved. Invalid requests return a JSON OAuth error with status 400.

## POST /authorize

Accepts the same OAuth fields plus `user` and `password`. The login form preserves state, scope, nonce and PKCE. The username portion before `@` is sent to RADIUS. Email claims always use the configured EMAIL_SUFFIX.

Successful authentication redirects to the registered callback with `code` and the original `state`. When `accept=json`, success returns `{ "redirect": "https://registered-callback/...?code=..." }` for browser navigation. It does not follow the external callback with fetch.

Invalid OAuth parameters return status 400 before RADIUS authentication. Rejected credentials or groups redirect to the local login page with `error=access_denied`; JSON mode returns 401. A foreign browser Origin returns 403. Authorization attempts are limited to 20 per account and socket peer per minute; status 429 includes Retry-After.

## POST /token

Authenticate with either HTTP Basic credentials or `client_id` and `client_secret` form fields. Do not mix both methods. Basic values use OAuth form encoding before base64 encoding. Invalid credentials return 401 with `invalid_client`.

For `grant_type=authorization_code`, provide `code` and the same exact `redirect_uri` used at authorization. If PKCE was used, provide `code_verifier` with 43–128 permitted characters matching the S256 challenge. A code can be redeemed once; failed attempts also consume it.

For `grant_type=refresh_token`, provide `refresh_token`. The token is bound to the client, can be used once, and is replaced on success. The replacement keeps the original refresh-session expiration. A refresh does not reauthenticate with RADIUS; current permitted/admin configuration is applied to stored groups.

Success returns `access_token`, `token_type=bearer`, `expires_in=3600`, `id_token`, `refresh_token`, and `scope`. The initial ID token includes the authorization nonce if supplied. Expired, missing, mismatched or reused grants return 400 with `invalid_grant`. Unsupported grants return 400 with `unsupported_grant_type`. Responses are not cacheable.
