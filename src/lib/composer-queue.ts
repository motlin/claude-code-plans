import { useSyncExternalStore } from "react";

/**
 * Prompts typed while the live pane is working, per session and in memory
 * only. The session page flushes them one at a time as the session goes idle,
 * like claude.ai/code's frontend queue.
 */

export interface QueuedPrompt {
  id: string;
  text: string;
}

export type ComposerQueueAction =
  | { type: "enqueue"; item: QueuedPrompt; position?: "back" | "front" }
  | { type: "edit"; id: string; text: string }
  | { type: "remove"; id: string }
  | { type: "reorder"; id: string; toIndex: number };

export function composerQueueReducer(
  queue: readonly QueuedPrompt[],
  action: ComposerQueueAction,
): readonly QueuedPrompt[] {
  switch (action.type) {
    case "enqueue":
      return action.position === "front" ? [action.item, ...queue] : [...queue, action.item];
    case "edit":
      return queue.map((item) => (item.id === action.id ? { ...item, text: action.text } : item));
    case "remove":
      return queue.filter((item) => item.id !== action.id);
    case "reorder": {
      const item = queue.find((candidate) => candidate.id === action.id);
      if (item === undefined) return queue;
      const rest = queue.filter((candidate) => candidate.id !== action.id);
      const index = Math.max(0, Math.min(action.toIndex, rest.length));
      return [...rest.slice(0, index), item, ...rest.slice(index)];
    }
  }
}

/** The prompt to send next: the head of the queue, once the session is idle. */
export function nextQueuedPrompt(
  queue: readonly QueuedPrompt[],
  busy: boolean,
): QueuedPrompt | null {
  return busy ? null : (queue[0] ?? null);
}

export function queuedStatusText(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"} queued. Will send after the current response.`;
}

const EMPTY: readonly QueuedPrompt[] = [];

let queues = new Map<string, readonly QueuedPrompt[]>();
const listeners = new Set<() => void>();
let nextId = 1;

export function newQueuedPrompt(text: string): QueuedPrompt {
  return { id: `queued-${nextId++}`, text };
}

function getComposerQueue(sessionId: string): readonly QueuedPrompt[] {
  return queues.get(sessionId) ?? EMPTY;
}

export function dispatchComposerQueue(sessionId: string, action: ComposerQueueAction): void {
  const next = composerQueueReducer(getComposerQueue(sessionId), action);
  queues = new Map(queues);
  if (next.length === 0) queues.delete(sessionId);
  else queues.set(sessionId, next);
  for (const listener of listeners) listener();
}

export function clearComposerQueues(): void {
  queues = new Map();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useComposerQueueItems(sessionId: string): readonly QueuedPrompt[] {
  return useSyncExternalStore(
    subscribe,
    () => getComposerQueue(sessionId),
    () => EMPTY,
  );
}
