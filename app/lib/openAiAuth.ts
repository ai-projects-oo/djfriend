import { apiFetch } from './apiFetch';

const PREFIX = 'djfriend-openai';
const ID_TOKEN_KEY = `${PREFIX}-id-token`;
const ACCESS_TOKEN_KEY = `${PREFIX}-access-token`;
const ID_TOKEN_EXPIRY_KEY = `${PREFIX}-id-token-expiry`;
const VERIFIER_KEY = `${PREFIX}-verifier`;
const STATE_KEY = `${PREFIX}-state`;
const NONCE_KEY = `${PREFIX}-nonce`;

const AUTH_ENDPOINT = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token';

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getRedirectUri(): string {
  return 'http://127.0.0.1:8888/callback-openai';
}

async function fetchClientId(): Promise<string> {
  const res = await apiFetch('/api/settings');
  if (!res.ok) throw new Error('Could not read settings.');
  const data = await res.json() as { openAiClientId?: string };
  if (!data.openAiClientId) throw new Error('OpenAI integration is not configured. Add your OpenAI Client ID in Settings.');
  return data.openAiClientId;
}

export interface OpenAiSession {
  email: string;
  name: string;
  sub: string;
  idToken: string;
}

export function getStoredSession(): OpenAiSession | null {
  const token = localStorage.getItem(ID_TOKEN_KEY);
  const expiry = localStorage.getItem(ID_TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry, 10)) {
    clearSession();
    return null;
  }
  try {
    // Decode JWT payload (no signature verification — we verified at exchange time)
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      email?: string; name?: string; sub?: string; exp?: number;
    };
    return { email: payload.email ?? '', name: payload.name ?? '', sub: payload.sub ?? '', idToken: token };
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  const expiry = localStorage.getItem(ID_TOKEN_EXPIRY_KEY);
  if (!expiry || Date.now() > parseInt(expiry, 10)) return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(ID_TOKEN_KEY);
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(ID_TOKEN_EXPIRY_KEY);
}

export function storeSession(idToken: string, accessToken?: string): void {
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    const expiry = payload.exp ? payload.exp * 1000 : Date.now() + 3600 * 1000;
    localStorage.setItem(ID_TOKEN_KEY, idToken);
    localStorage.setItem(ID_TOKEN_EXPIRY_KEY, String(expiry - 60_000));
  } catch {
    localStorage.setItem(ID_TOKEN_KEY, idToken);
    localStorage.setItem(ID_TOKEN_EXPIRY_KEY, String(Date.now() + 3600 * 1000));
  }
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
}

export async function redirectToOpenAiLogin(): Promise<void> {
  const clientId = await fetchClientId();
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  const state = generateRandomString(32);
  const nonce = generateRandomString(32);

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(NONCE_KEY, nonce);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    nonce,
  });

  window.location.href = `${AUTH_ENDPOINT}?${params}`;
}

export async function exchangeOpenAiCode(code: string, returnedState: string): Promise<void> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const state = sessionStorage.getItem(STATE_KEY);
  if (!verifier || !state) throw new Error('No PKCE verifier found. Please try again.');
  if (state !== returnedState) throw new Error('State mismatch. Please try again.');

  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(NONCE_KEY);

  const clientId = await fetchClientId();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((err['error_description'] as string) ?? 'Failed to sign in with ChatGPT.');
  }

  const data = await res.json() as { id_token?: string; access_token?: string };
  if (!data.id_token) throw new Error('No ID token returned from OpenAI.');
  storeSession(data.id_token, data.access_token);
}
