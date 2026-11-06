import type { Metadata } from "next";

import { PasswordPage } from "./password-page";

export const metadata: Metadata = { title: "Create your password" };

// Kept for links issued before the separate create / reset pages (2026-11-06).
export default function SetPasswordPage() {
  return <PasswordPage mode="create" />;
}
