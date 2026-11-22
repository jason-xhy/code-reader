// Request budgets and endpoint compatibility are independent of saved selection.
export const MODEL_LIST_TIMEOUT_MS = 20_000;
export const COMPLETION_TIMEOUT_MS = 90_000;
export const CHATGPT_TIMEOUT_MS = 120_000;
export function supportsOpenaiChatModel(id) {
  return typeof id === 'string' && /^(gpt-|chatgpt-|o[134](?:-|$))/.test(id)
    && !/audio|realtime|transcribe|tts|image|search|embedding|moderation|codex|live|(?:^|-)pro(?:-|$)/.test(id);
}
