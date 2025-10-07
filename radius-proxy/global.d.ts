declare global {
  var _oauth_codes: Record<
    string,
    {
      username: string
      class?: string
      scope?: string
      groups?: string[]
      expiresAt?: number
    }
  >
}

export {}