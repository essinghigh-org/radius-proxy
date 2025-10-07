// Initialize runtime globals used by OAuth authorization code storage.
// Import this module (e.g. `import "@/lib"`) from server-side routes to ensure
// a single shared in-memory code map exists during the process lifetime.
if (!global._oauth_codes) {
  global._oauth_codes = {}
}

export {}