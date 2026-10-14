export function setAppPassword(p: string): void {
  sessionStorage.setItem('djfriend-app-password', p);
}

export function getAppPassword(): string {
  return sessionStorage.getItem('djfriend-app-password') ?? '';
}

/** Wraps fetch, injecting X-App-Password for all /api/* calls. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const password = getAppPassword();
  if (!password || !input.startsWith('/')) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('X-App-Password', password);
  return fetch(input, { ...init, headers });
}
