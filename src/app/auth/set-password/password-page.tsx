import { AuthShell } from "@/components/app/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PasswordMode } from "@/lib/auth/actions";
import { ORG_NAME } from "@/lib/brand";

import { SetPasswordForm } from "./set-password-form";

const COPY: Record<PasswordMode, { title: string; description: string }> = {
  create: {
    title: "Create your password",
    description: `Welcome to ${ORG_NAME}. Choose a password to finish setting up your account.`,
  },
  reset: {
    title: "Reset your password",
    description: "Choose a new password. You'll sign in with it afterwards.",
  },
};

/**
 * Shared by /auth/create-password (invitations) and /auth/reset-password
 * (recovery). Reached from /auth/confirm or /auth/callback with the link's
 * session; the proxy requires that session and setPassword re-checks it.
 */
export function PasswordPage({ mode }: { mode: PasswordMode }) {
  const copy = COPY[mode];
  return (
    <AuthShell>
      <Card className="shadow-pop">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm mode={mode} />
        </CardContent>
      </Card>
    </AuthShell>
  );
}
