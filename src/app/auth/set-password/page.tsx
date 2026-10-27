import { ListChecks } from "lucide-react";
import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ORG_NAME, PRODUCT_NAME } from "@/lib/brand";

import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = {
  title: "Set your password",
};

// Reached after accepting an invitation (/auth/confirm). The proxy requires a
// session for this route; the action re-checks it and the account status.
export default function SetPasswordPage() {
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-foreground">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ListChecks className="size-5" aria-hidden="true" />
          </span>
          <span className="grid leading-tight">
            <span className="text-lg font-semibold tracking-tight">{ORG_NAME}</span>
            <span className="text-xs text-muted-foreground">{PRODUCT_NAME}</span>
          </span>
        </div>
        <Card className="shadow-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Set your password</CardTitle>
            <CardDescription>Choose a password for your {ORG_NAME} account.</CardDescription>
          </CardHeader>
          <CardContent>
            <SetPasswordForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
