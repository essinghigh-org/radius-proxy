import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import Image from "next/image"

interface LoginFormProps extends React.ComponentProps<'div'> {
  clientId: string
  redirectUri?: string
  state?: string
  error?: string
  errorDescription?: string
}

export function LoginForm({ className, clientId, redirectUri, state, error, errorDescription, ...props }: LoginFormProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form className="p-6 md:p-8" method="post" action="/radius_login/api/oauth/authorize">
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Welcome back</h1>
                <p className="text-muted-foreground text-balance">
                  Login to Grafana with your admin account
                </p>
              </div>
              {error && (
                <div className="text-sm text-red-600 border border-red-500/40 bg-red-50 dark:bg-red-950/30 rounded p-2 mb-2 w-full">
                  <strong>{error}</strong>{errorDescription ? `: ${errorDescription}` : ''}
                </div>
              )}
              <Field>
                <FieldLabel htmlFor="user">User</FieldLabel>
                <Input
                  id="user"
                  name="user"
                  type="text"
                  placeholder="adm_example"
                  required
                  autoComplete="username"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" name="password" type="password" required autoComplete="current-password" />
              </Field>
              <input type="hidden" name="client_id" value={clientId} />
              {redirectUri && (<input type="hidden" name="redirect_uri" value={redirectUri} />)}
              {state && (<input type="hidden" name="state" value={state} />)}
              <Field>
                <Button type="submit">Login</Button>
              </Field>
            </FieldGroup>
          </form>
          <div className="bg-muted relative hidden md:block">
            <div className="absolute inset-0 p-8">
              <Image
                src="/grafana-logo.svg"
                alt="Grafana Logo"
                className="object-contain transform scale-50"
                fill
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
