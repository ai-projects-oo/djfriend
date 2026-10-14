const KEY_STORAGE = 'djfriend-openai-key';

export interface OpenAiSession {
  email: string;
  name: string;
  sub: string;
  idToken: string;
}

export function saveApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function getAccessToken(): string | null {
  return localStorage.getItem(KEY_STORAGE) || null;
}

export function getStoredSession(): OpenAiSession | null {
  const key = localStorage.getItem(KEY_STORAGE);
  if (!key) return null;
  return { email: '', name: 'OpenAI', sub: '', idToken: key };
}

export function clearSession(): void {
  localStorage.removeItem(KEY_STORAGE);
}
