import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ORG_NAME, PRODUCT_NAME } from "@/lib/brand";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
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
      </div>
    </main>
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
