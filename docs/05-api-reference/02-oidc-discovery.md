# OIDC discovery and UserInfo

`GET /.well-known/openid-configuration` returns the configured issuer, canonical authorization/token/UserInfo/JWKS URLs, supported scopes, S256 PKCE support, code and refresh grants, client authentication methods, and the actual signing algorithm. Host and forwarded headers cannot change these values.

Discovery is also served at `/radius_login/api/.well-known/openid-configuration` and `/api/.well-known/openid-configuration`. JWKS is available at the corresponding `jwks.json` paths and `/.well-known/jwks.json`. The prefixed discovery/JWKS routes support CORS OPTIONS.

`GET /radius_login/api/.well-known/jwks.json` publishes the RSA public key with its kid and signing use. HS256 deployments return an empty key set; clients need the shared signing secret instead. Never publish the HMAC secret as a JWK.

`GET /radius_login/api/oauth/userinfo` requires an Authorization Bearer access token. It returns `sub`, `name`, `groups`, `grafana_admin` and the optional `role`. `GET /radius_login/api/oauth/userinfo/emails` returns `[{ "email": "user@example.com", "primary": true }]`, or an empty array when no email claim is present. The `/api/` aliases are also supported.

Both UserInfo endpoints reject malformed, expired, wrong-issuer or wrong-audience tokens with 401. ID tokens cannot be used as access tokens.
