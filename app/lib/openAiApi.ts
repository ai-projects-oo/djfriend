import { getAccessToken } from './openAiAuth';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatComplete(
  messages: ChatMessage[],
  opts: { model?: string; maxTokens?: number } = {},
): Promise<string> {
  const token = getAccessToken();
  if (!token) throw new Error('Not signed in with ChatGPT. Sign in via Settings.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: opts.model ?? 'gpt-4o-mini',
      messages,
      max_tokens: opts.maxTokens ?? 400,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `OpenAI error ${res.status}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content?.trim() ?? '';
}
