"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPassword, type SetPasswordState } from "@/lib/auth/actions";
import { NEW_PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@/lib/auth/validation";

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(setPassword, {});

  return (
    <form action={formAction} className="grid gap-5">
      {state.error && !pending ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={NEW_PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          className="h-10"
        />
        <p className="text-xs text-muted-foreground">At least {NEW_PASSWORD_MIN_LENGTH} characters.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required maxLength={PASSWORD_MAX_LENGTH} className="h-10" />
      </div>
      <Button type="submit" className="h-10" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Save password and continue
      </Button>
    </form>
  );
}
