// Login form validation, shared by the client form (instant feedback) and the
// server action (authoritative).

export type LoginFieldErrors = {
  email?: string;
  password?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 6; // Supabase Auth default minimum
export const PASSWORD_MAX_LENGTH = 72; // bcrypt limit used by Supabase Auth
/** Minimum for passwords chosen in the app (stricter than the Auth default). */
export const NEW_PASSWORD_MIN_LENGTH = 8;

export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < NEW_PASSWORD_MIN_LENGTH) return `Password must be at least ${NEW_PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (password !== confirm) return "The passwords do not match.";
  return null;
}

export function validateLogin(email: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};

  if (!email) {
    errors.email = "Email is required.";
  } else if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!password) {
    errors.password = "Password is required.";
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.password = `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }

  return errors;
}
