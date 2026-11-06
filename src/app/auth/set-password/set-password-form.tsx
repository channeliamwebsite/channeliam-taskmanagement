"use client";

import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPassword, type PasswordMode, type SetPasswordState } from "@/lib/auth/actions";
import { NEW_PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@/lib/auth/validation";

function PasswordField({ id, label, hint }: { id: string; label: string; hint?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={id === "password" ? NEW_PASSWORD_MIN_LENGTH : undefined}
          maxLength={PASSWORD_MAX_LENGTH}
          className="h-10 pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** New password + confirmation. `mode` decides what happens after saving (see setPassword). */
export function SetPasswordForm({ mode = "create" }: { mode?: PasswordMode }) {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(setPassword, {});

  return (
    <form action={formAction} className="grid gap-5">
      <input type="hidden" name="mode" value={mode} />
      {state.error && !pending ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <PasswordField id="password" label="New password" hint={`At least ${NEW_PASSWORD_MIN_LENGTH} characters.`} />
      <PasswordField id="confirm" label="Confirm password" />
      <Button type="submit" className="h-10" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {pending ? "Saving…" : mode === "reset" ? "Reset password" : "Create password and continue"}
      </Button>
    </form>
  );
}
