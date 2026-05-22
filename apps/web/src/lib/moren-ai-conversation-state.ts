export const MOREN_AI_CONVERSATION_KEY = 'moren-ai-active-conversation-id';
export const MOREN_AI_CONVERSATION_EVENT = 'moren-ai:conversation-changed';

export function getStoredMorenAiConversationId() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(MOREN_AI_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

export function setStoredMorenAiConversationId(conversationId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (conversationId) {
      window.localStorage.setItem(MOREN_AI_CONVERSATION_KEY, conversationId);
    } else {
      window.localStorage.removeItem(MOREN_AI_CONVERSATION_KEY);
    }
  } catch {}

  window.dispatchEvent(new CustomEvent(MOREN_AI_CONVERSATION_EVENT, {
    detail: { conversationId },
  }));
}
