import { SignJWT, jwtVerify, createRemoteJWKSet, decodeJwt } from 'jose';
import type { AuthUser } from './types';

const SESSION_COOKIE = 'session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookieHeader(token: string, appUrl: string): string {
  const secure = appUrl.startsWith('https://');
  const sameSite = secure ? 'None' : 'Lax';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=${sameSite}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookieHeader(appUrl: string): string {
  const secure = appUrl.startsWith('https://');
  const sameSite = secure ? 'None' : 'Lax';
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}${secure ? '; Secure' : ''}`;
}

export function readSessionToken(cookieHeader: string | null): string | null {
  return getCookieValue(cookieHeader, SESSION_COOKIE);
}

export async function createSessionToken(user: AuthUser, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifySessionToken(token: string, secret: string): Promise<AuthUser | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    return {
      id: Number(payload.sub),
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as AuthUser['role'],
    };
  } catch {
    return null;
  }
}

// Verifies a Google Identity Services ID token against Google's public keys.
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function verifyGoogleIdToken(idToken: string, clientId: string) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  });
  return payload as { sub: string; email: string; name: string; email_verified?: boolean };
}

export function decodeUnverified(token: string) {
  return decodeJwt(token);
}
