/* eslint-disable @typescript-eslint/no-explicit-any */
import { LoginForm } from "@/components/login-form"

export default async function LoginPage(props: any) {
  const raw = props?.searchParams
  let sp: Record<string, string | string[]> = {}
  if (raw) {
    if (typeof raw.then === 'function') {
      sp = await raw
    } else {
      sp = raw as Record<string, string | string[]>
    }
  }

  const pick = (k: string) => {
    const v = sp[k]
    return Array.isArray(v) ? v[0] : (v || '')
  }
  const clientId = pick('client_id') || 'grafana'
  const redirectUri = pick('redirect_uri')
  const state = pick('state')
  const error = pick('error')
  const errorDescription = pick('error_description')
  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <LoginForm clientId={clientId} redirectUri={redirectUri} state={state} error={error} errorDescription={errorDescription} />
      </div>
    </div>
  )
}
