import { redirect } from "next/navigation";

import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/auth/routes";

// Signed-out visitors never reach this page: the proxy sends them to /login.
export default function Home() {
  redirect(DEFAULT_AUTHENTICATED_ROUTE);
}
