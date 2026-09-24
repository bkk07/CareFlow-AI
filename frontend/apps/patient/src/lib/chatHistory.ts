import type { ChatMessage } from "../types";

/** Local chat-history store (no backend conversation-list API exists, so the
 *  patient app persists transcripts in localStorage, keyed by the backend
 *  conversation id from POST /chat). Bounded so private-mode/quota failures
 *  degrade to a fresh chat instead of breaking the thread. */

export interface StoredChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

export const ACTIVE_CONV_KEY = "careflow_patient_conversation";

const LIST_KEY = "careflow_patient_chats";
const MAX_CHATS = 20;
const MAX_MESSAGES = 100;

function readAll(): Record<string, StoredChat> {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredChat>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, StoredChat>) {
  try {
    const ids = Object.values(all)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CHATS)
      .map((c) => c.id);
    const trimmed: Record<string, StoredChat> = {};
    for (const id of ids) trimmed[id] = all[id];
    localStorage.setItem(LIST_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota / private mode — chat still works, history just isn't kept */
  }
}

export function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.from === "patient");
  const text = (first?.text ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "New chat";
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

export function getActiveConversationId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CONV_KEY);
  } catch {
    return null;
  }
}

export function setActiveConversationId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_CONV_KEY, id);
    else localStorage.removeItem(ACTIVE_CONV_KEY);
  } catch {
    /* private mode */
  }
}

export function loadChatMessages(id: string): ChatMessage[] | null {
  const hit = readAll()[id];
  if (!hit || !Array.isArray(hit.messages) || hit.messages.length === 0) return null;
  return hit.messages;
}

export function saveChatMessages(id: string, messages: ChatMessage[]) {
  if (!id || messages.length === 0) return;
  const all = readAll();
  const prev = all[id];
  all[id] = {
    id,
    title: deriveTitle(messages),
    updatedAt: Date.now(),
    messages: messages.slice(-MAX_MESSAGES),
  };
  // Preserve an existing nicer title when the new one would be "New chat".
  if (prev && all[id].title === "New chat" && prev.title !== "New chat") {
    all[id].title = prev.title;
  }
  writeAll(all);
}

export function listChats(): StoredChat[] {
  return Object.values(readAll()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteChat(id: string) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}
