"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import Image from "next/image"
import { useState, useRef } from "react"

interface LoginFormProps extends React.ComponentProps<'div'> {
  clientId: string
  redirectUri?: string
  state?: string
  error?: string
  errorDescription?: string
}

export function LoginForm({ className, clientId, redirectUri, state, error, errorDescription, ...props }: LoginFormProps) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const formAction = `${basePath}/api/oauth/authorize`;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const toastId = useRef<string | number | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isSubmitting) return;

    setIsSubmitting(true);
    timeoutRef.current = setTimeout(() => {
      toastId.current = toast.loading("Check your phone for an MFA prompt!", {
        duration: Infinity,
      });
    }, 2000);

    try {
      const formData = new FormData(e.currentTarget);

      const response = await fetch(formAction, {
        method: 'POST',
        body: formData
      });

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Dismiss the MFA toast if it was shown
      if (toastId.current) {
        toast.dismiss(toastId.current);
        toastId.current = null;
      }

      if (response.redirected) {
        // Follow the redirect
        window.location.href = response.url;
      } else if (!response.ok) {
        // Handle error response
        const responseText = await response.text();
        const errorMatch = responseText.match(/error=([^&]+)/);
        const descMatch = responseText.match(/error_description=([^&]+)/);

        if (errorMatch) {
          toast.error("Authentication failed", {
            description: descMatch ? decodeURIComponent(descMatch[1]) : "Please check your credentials"
          });
        } else {
          toast.error("Authentication failed", {
            description: "Please check your credentials and try again"
          });
        }
      }
    } catch {
      // Clear timeout on error
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (toastId.current) {
        toast.dismiss(toastId.current);
        toastId.current = null;
      }

      toast.error("Connection failed", {
        description: "Unable to connect to the authentication server"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form className="p-6 md:p-8" onSubmit={handleSubmit}>
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
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Authenticating..." : "Login"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
          <div className="bg-muted relative hidden md:block">
            <div className="absolute inset-0 p-8">
              <Image
                src={`${basePath}/grafana-logo.svg`}
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
