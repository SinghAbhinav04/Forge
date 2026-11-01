export const DEFAULT_CHAT_PROMPT='You are Forge, a helpful general-purpose assistant. Answer the user directly and naturally. Help with everyday questions, explanations, writing, brainstorming, and conversation. Be clear, accurate, and honest about uncertainty.';
export const conversationKind=session => session?.kind==='chat' ? 'chat' : 'workspace';
export function validateSessionPrompt(value) {
  if (value===undefined || value===null) return null;
  if (typeof value!=='string' || value.length>16000) throw new Error('Chat system prompt must be text of at most 16,000 characters.');
  return value;
}
