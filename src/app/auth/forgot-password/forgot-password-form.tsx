"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset, type ResetRequestState } from "@/lib/auth/actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ResetRequestState, FormData>(requestPasswordReset, {});

  if (state.sent && !pending) {
    return (
      <Alert aria-live="polite">
        <CheckCircle2 />
        <AlertDescription>{state.sent}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {state.error && !pending ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          defaultValue={state.email ?? ""}
          disabled={pending}
          aria-invalid={Boolean(state.fieldError)}
          aria-describedby={state.fieldError ? "email-error" : undefined}
          className="h-10"
        />
        {state.fieldError && !pending ? (
          <p id="email-error" className="text-sm text-destructive">
            {state.fieldError}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            Sending…
          </>
        ) : (
          "Send reset link"
        )}
      </Button>
    </form>
  );
}
