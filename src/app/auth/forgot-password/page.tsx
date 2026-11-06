import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LOGIN_ROUTE } from "@/lib/auth/routes";
import { AuthShell } from "@/components/app/brand";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell>

        <Card className="shadow-pop">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Reset your password</CardTitle>
            <CardDescription>Enter your work email and we&apos;ll send you a link to choose a new password.</CardDescription>
          </CardHeader>
          <CardContent>
            <ForgotPasswordForm />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href={LOGIN_ROUTE} className="underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
  );
}
