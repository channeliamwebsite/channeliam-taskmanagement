import type { Metadata } from "next";
import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuthShell } from "@/components/app/brand";
import { ORG_NAME } from "@/lib/brand";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <AuthShell>

        <Card className="shadow-pop">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Use your {ORG_NAME} work email and password.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* The form reads ?next= and ?error= from the URL, so it renders
                at request time inside a Suspense boundary. */}
            <Suspense fallback={<LoginFormSkeleton />}>
              <LoginForm />
            </Suspense>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is managed by your {ORG_NAME} administrator.
        </p>
      </AuthShell>
  );
}

function LoginFormSkeleton() {
  return (
    <div className="grid gap-5" aria-hidden="true">
      <div className="grid gap-2">
        <div className="h-4 w-12 rounded bg-muted" />
        <div className="h-10 rounded-lg bg-muted" />
      </div>
      <div className="grid gap-2">
        <div className="h-4 w-16 rounded bg-muted" />
        <div className="h-10 rounded-lg bg-muted" />
      </div>
      <div className="h-10 rounded-lg bg-muted" />
    </div>
  );
}
