"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { LOGIN_ROUTE, safeRedirectPath } from "./routes";
import { validateLogin, type LoginFieldErrors } from "./validation";

export type SignInState = {
  error?: string;
  fieldErrors?: LoginFieldErrors;
  email?: string;
};

const INVALID_CREDENTIALS = "Invalid email or password.";

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeRedirectPath(String(formData.get("next") ?? ""));

  const fieldErrors = validateLogin(email, password);
  if (fieldErrors.email || fieldErrors.password) {
    return { fieldErrors, email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    // Generic message: do not reveal whether the account exists.
    if (error?.code === "email_not_confirmed") {
      return { error: "Please confirm your email address before signing in.", email };
    }
    if (error?.status === 429) {
      return { error: "Too many sign-in attempts. Please wait a moment and try again.", email };
    }
    return { error: INVALID_CREDENTIALS, email };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return {
      error: profile
        ? "Your account has been deactivated. Contact an administrator."
        : "Your account is not set up yet. Contact an administrator.",
      email,
    };
  }

  redirect(next);
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(LOGIN_ROUTE);
}
