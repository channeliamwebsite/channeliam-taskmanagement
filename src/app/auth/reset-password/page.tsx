import type { Metadata } from "next";

import { PasswordPage } from "../set-password/password-page";

export const metadata: Metadata = { title: "Reset your password" };

// Password-reset links land here (via /auth/confirm or /auth/callback).
export default function ResetPasswordPage() {
  return <PasswordPage mode="reset" />;
}
