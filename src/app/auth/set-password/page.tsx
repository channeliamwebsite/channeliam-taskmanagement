import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthShell } from "@/components/app/brand";
import { ORG_NAME } from "@/lib/brand";

import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "Set your password",
};

// Reached from an invitation or password-reset link (/auth/confirm). The proxy requires a
// session for this route; the action re-checks it and the account status.
export default function SetPasswordPage() {
  return (
    <AuthShell>
        <Card className="shadow-pop">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Choose a password</CardTitle>
            <CardDescription>Set a new password for your {ORG_NAME} account. You&apos;ll stay signed in afterwards.</CardDescription>
          </CardHeader>
          <CardContent>
            <SetPasswordForm />
          </CardContent>
        </Card>
      </AuthShell>
  );
}
