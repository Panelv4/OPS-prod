"use client";
// The bearer credential lives exclusively in the HttpOnly cookie. CSRF is intentionally readable.
let csrf: string | null = null;
export function saveClientSession(token?: string) {
  csrf = token || null;
}
export function getClientCsrfToken() {
  return csrf;
}
export function clearClientSession() {
  csrf = null;
}
