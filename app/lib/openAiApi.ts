import { getAccessToken } from './openAiAuth';

export async function validateApiKey(key: string): Promise<void> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) throw new Error('Invalid API key — check you copied it correctly.');
  if (res.status === 429) throw new Error('Rate limited — wait a moment and try again.');
  if (!res.ok) throw new Error(`OpenAI returned ${res.status}. Check your key and try again.`);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatComplete(
  messages: ChatMessage[],
  opts: { model?: string; maxTokens?: number } = {},
): Promise<string> {
  const token = getAccessToken();
  if (!token) throw new Error('No OpenAI API key set. Add one in Settings → AI.');

  const res = await fetch('/api/ai/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      model: opts.model ?? 'gpt-4o-mini',
      maxTokens: opts.maxTokens ?? 400,
      apiKey: token,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `OpenAI error ${res.status}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content?.trim() ?? '';
}
