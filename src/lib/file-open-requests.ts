import type { FileRef } from "./file-refs";

type Listener = (ref: FileRef) => void;

const listeners = new Map<string, Set<Listener>>();
const pendingBySession = new Map<string, FileRef>();

/**
 * Ask the session's Files pane to open `ref` as a preview tab. A mounted pane
 * handles it at once; otherwise it waits until the pane mounts and takes it.
 */
export function requestFileOpen(sessionId: string, ref: FileRef): void {
  const sessionListeners = listeners.get(sessionId);
  if (sessionListeners === undefined || sessionListeners.size === 0) {
    pendingBySession.set(sessionId, ref);
    return;
  }
  for (const listener of sessionListeners) listener(ref);
}

/** Take the request made while the session's Files pane was closed, if any. */
export function takePendingFileOpen(sessionId: string): FileRef | null {
  const ref = pendingBySession.get(sessionId) ?? null;
  pendingBySession.delete(sessionId);
  return ref;
}

export function onFileOpenRequest(sessionId: string, listener: Listener): () => void {
  const sessionListeners = listeners.get(sessionId) ?? new Set();
  sessionListeners.add(listener);
  listeners.set(sessionId, sessionListeners);
  return () => {
    sessionListeners.delete(listener);
    if (sessionListeners.size === 0) listeners.delete(sessionId);
  };
}
