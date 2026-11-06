import type { Metadata } from "next";

import { AuthShell } from "@/components/app/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { AuthCallback } from "./callback-client";

export const metadata: Metadata = { title: "Verifying your link" };

// Neutral route (reachable signed in or out): see NEUTRAL_ROUTES.
export default function AuthCallbackPage() {
  return (
    <AuthShell>
      <Card className="shadow-pop">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">One moment</CardTitle>
          <CardDescription>We&apos;re checking your link.</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthCallback />
        </CardContent>
      </Card>
    </AuthShell>
  );
}
