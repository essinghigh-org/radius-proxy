# radius-proxy
## Runtime config reload

This project now supports automatic reload of `config.toml` so changes (for example to `PERMITTED_CLASSES`) take effect without restarting the server.

- Implementation: see [`radius-proxy/lib/config.ts:70`]. The loader uses a mtime check plus `fs.watch` to invalidate a cached config, and the exported `config` is a Proxy so callers read fresh values each access.
- Config file: [`radius-proxy/config.toml:1`].

Quick test
1. Edit and save the config, e.g. update `PERMITTED_CLASSES` in [`radius-proxy/config.toml:16`]:
```toml
# toml
PERMITTED_CLASSES = "admin_group,ops"
```
2. Trigger the authorize flow (or otherwise exercise code paths that read `config.PERMITTED_CLASSES`) and observe the new behavior immediately in the server logs.

Notes and caveats
- This approach works reliably in single-process dev servers. For multi-process or clustered production deployments use a shared configuration store (Redis/DB) or a coordinated reload mechanism (SIGHUP, admin API, or service mesh).
- If `fs.watch` isn't available on a platform, the loader still uses an mtime-on-access fallback (see [`radius-proxy/lib/config.ts:92`]).