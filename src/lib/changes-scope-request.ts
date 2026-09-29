import { saveChangesScope } from "./pane-layout";

/** Window event an already-open Changes pane listens for to switch scope. */
export const CHANGES_SCOPE_REQUEST_EVENT = "ccp:changes-scope-request";

export interface ChangesScopeRequest {
  sessionId: string;
  /** A formatted `SessionDiffScope`, e.g. `turn:<uuid>`. */
  scope: string;
}

/**
 * Persist `scope` as the session's Changes pane scope and tell a mounted pane
 * to switch to it; a pane mounting later reads the persisted value.
 */
export function requestChangesScope(sessionId: string, scope: string): void {
  saveChangesScope(sessionId, scope);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ChangesScopeRequest>(CHANGES_SCOPE_REQUEST_EVENT, {
      detail: { sessionId, scope },
    }),
  );
}
