import { LoginForm } from "@/components/login-form"
 
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams || {}
 
  const pick = (k: string) => {
    const v = sp[k]
    if (Array.isArray(v)) return v[0] || ""
    return (v as string) || ""
  }
 
  const clientId = pick("client_id") || "grafana"
  const redirectUri = pick("redirect_uri")
  const state = pick("state")
  const error = pick("error")
  const errorDescription = pick("error_description")
 
  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <LoginForm
          clientId={clientId}
          redirectUri={redirectUri}
          state={state}
          error={error}
          errorDescription={errorDescription}
        />
      </div>
    </div>
  )
}
