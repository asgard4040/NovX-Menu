export const DEFAULT_AI_MODEL = 'gemini-3.5-flash';

export const AI_MODELS = [
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'gemini' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'gemini' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'openai' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'openai' },
] as const;

export type AIProvider = 'gemini' | 'openai';

export function providerForAIModel(model: string): AIProvider | null {
  return AI_MODELS.find((option) => option.id === model)?.provider || null;
}

export function firstModelForProvider(provider: AIProvider): string {
  return AI_MODELS.find((option) => option.provider === provider)!.id;
}

export function openAIResponseText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const data = response as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
  return (data.output || []).filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text!.trim()).filter(Boolean).join('\n');
}
