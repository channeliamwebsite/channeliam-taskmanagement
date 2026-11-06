import type { Metadata } from "next";

import { PasswordPage } from "../set-password/password-page";

export const metadata: Metadata = { title: "Create your password" };

// Invitation links land here (via /auth/confirm or /auth/callback).
export default function CreatePasswordPage() {
  return <PasswordPage mode="create" />;
}
