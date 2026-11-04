/**
 * Guest accounts (JOB-064) carry a synthetic identity under this issuer, which no Google sign-in can
 * ever match. Kept free of imports so any module can recognise a guest session.
 */
export const GUEST_ISSUER = "urn:stardust:guest";

export function isGuestSession(session: { issuer: string }): boolean {
  return session.issuer === GUEST_ISSUER;
}
