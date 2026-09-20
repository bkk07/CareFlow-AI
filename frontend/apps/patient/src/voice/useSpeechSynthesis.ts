/**
 * useSpeechSynthesis — browser-native TTS for AI replies.
 *
 * Uses only `window.speechSynthesis` + `SpeechSynthesisUtterance`.
 * No network calls, no external TTS API. The AI response text is
 * cleaned to natural readable text before speaking.
 *
 * - `speak`: cancel anything in-flight, then speak (text chat: one
 *   reply at a time, never overlapping).
 * - `enqueue`: append to the native utterance queue without canceling
 *   (live voice: server sentences stream in one by one and must play
 *   in order, not cut each other off).
 * - `stop`: cancel everything (`speechSynthesis.cancel()`).
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Strip markdown / citations / code / URLs down to speakable text. */
export function cleanTextForSpeech(raw: string): string {
  let text = raw ?? "";
  // Fenced code blocks (```...```) — drop entirely.
  text = text.replace(/```[\s\S]*?```/g, " ");
  // Inline code (`...`) — keep the content, drop backticks.
  text = text.replace(/`([^`]*?)`/g, "$1");
  // Images ![alt](url) → alt.
  text = text.replace(/!\[([^\]]*?)\]\([^)]*?\)/g, "$1");
  // Links [label](url) → label.
  text = text.replace(/\[([^\]]*?)\]\([^)]*?\)/g, "$1");
  // Markdown headings, quotes, list markers, bold/italic/strike.
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^(\s*)[-*+]\s+/gm, "$1");
  text = text.replace(/^(\s*)\d+[.)]\s+/gm, "$1");
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");
  // Citation / reference markup: [1], [12], 【...】, (Source: ...).
  text = text.replace(/\[\d+(?:[,-]\d+)*\]/g, " ");
  text = text.replace(/【[^】]*】/g, " ");
  text = text.replace(/\(sources?:[^)]*?\)/gi, " ");
  // Bare URLs.
  text = text.replace(/https?:\/\/\S+/g, " ");
  // LaTeX-ish leftovers ($...$, \(...\), \[...\]).
  text = text.replace(/\$\$[\s\S]*?\$\$/g, " ");
  text = text.replace(/\$([^$]+?)\$/g, "$1");
  // Collapse whitespace.
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

interface UseSpeechSynthesis {
  isSupported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  enqueue: (text: string) => void;
  stop: () => void;
}

export function useSpeechSynthesis(): UseSpeechSynthesis {
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pendingRef = useRef(0);
  const supported = isSpeechSynthesisSupported();

  const markDone = useCallback((utterance: SpeechSynthesisUtterance) => {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    if (utteranceRef.current === utterance) utteranceRef.current = null;
    if (pendingRef.current === 0) setSpeaking(false);
  }, []);

  const stop = useCallback(() => {
    if (!isSpeechSynthesisSupported()) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    pendingRef.current = 0;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!isSpeechSynthesisSupported()) return;
      // Prevent overlap: cancel any in-flight utterance first.
      window.speechSynthesis.cancel();
      pendingRef.current = 0;
      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) return;
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utteranceRef.current = utterance;
      pendingRef.current = 1;
      utterance.onend = () => markDone(utterance);
      utterance.onerror = () => markDone(utterance);
      setSpeaking(true);
      // Nudge a stuck (paused) engine; no-op when idle/speaking.
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    },
    [markDone],
  );

  const enqueue = useCallback(
    (text: string) => {
      if (!isSpeechSynthesisSupported()) return;
      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) return;
      const utterance = new SpeechSynthesisUtterance(cleaned);
      // Native queue order: sentences play sequentially, never overlap.
      if (!utteranceRef.current) utteranceRef.current = utterance;
      pendingRef.current += 1;
      utterance.onend = () => markDone(utterance);
      utterance.onerror = () => markDone(utterance);
      setSpeaking(true);
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    },
    [markDone],
  );

  // Stop speech when the component using TTS unmounts.
  useEffect(() => {
    return () => {
      if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
    };
  }, []);

  return { isSupported: supported, speaking, speak, enqueue, stop };
}
