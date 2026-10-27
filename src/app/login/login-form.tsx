"use client";

import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useActionState, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type SignInState } from "@/lib/auth/actions";
import { validateLogin, type LoginFieldErrors } from "@/lib/auth/validation";

const URL_ERRORS: Record<string, string> = {
  account_inactive: "Your account has been deactivated. Contact an administrator.",
  profile_missing: "Your account is not set up yet. Contact an administrator.",
  link_invalid: "That invitation link is invalid or has expired. Ask your administrator for a new one.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";
  const urlError = URL_ERRORS[searchParams.get("error") ?? ""];

  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, {});
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [clientErrors, setClientErrors] = useState<LoginFieldErrors>({});

  const fieldErrors = { ...state.fieldErrors, ...clientErrors };
  // Hide the previous attempt's error while a new attempt is in flight.
  const formError = pending ? undefined : (state.error ?? (state.fieldErrors ? undefined : urlError));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const errors = validateLogin(
      String(data.get("email") ?? "").trim(),
      String(data.get("password") ?? ""),
    );
    setClientErrors(errors);
    if (errors.email || errors.password) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="grid gap-5">
      <input type="hidden" name="next" value={next} />

      {formError ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertCircle />
          <AlertDescription>{formError}</AlertDescription>
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
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (clientErrors.email) setClientErrors((e) => ({ ...e, email: undefined }));
          }}
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          className="h-10"
        />
        {fieldErrors.email ? (
          <p id="email-error" className="text-sm text-destructive">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            onChange={() => {
              if (clientErrors.password) setClientErrors((e) => ({ ...e, password: undefined }));
            }}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
            className="h-10 pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            disabled={pending}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {fieldErrors.password ? (
          <p id="password-error" className="text-sm text-destructive">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}
