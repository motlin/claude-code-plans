import { createContext, useContext, type ReactNode } from "react";

interface AnswerSubmission {
  toolUseId: string;
  answers: Array<{ question: string; answer: string }>;
}

export interface AskUserQuestionContextValue {
  /**
   * True when the session is currently active (CLI process likely running).
   * Used to decide whether to render the answer form on a pending question.
   */
  isSessionActive: boolean;
  /**
   * Submit an answer to a pending AskUserQuestion. Returns when the spawned
   * resume process has accepted the answer (or rejects with an error). The
   * caller is responsible for any UI feedback while awaiting.
   */
  submitAnswer: (submission: AnswerSubmission) => Promise<void>;
  /**
   * The pending question currently docked above the composer, if any. Its
   * inline renderer collapses to an "Asking <header>" summary instead of a form.
   */
  dockedToolUseId?: string | null;
}

const AskUserQuestionContext = createContext<AskUserQuestionContextValue | null>(null);

export function AskUserQuestionProvider({
  value,
  children,
}: {
  value: AskUserQuestionContextValue;
  children: ReactNode;
}) {
  return (
    <AskUserQuestionContext.Provider value={value}>{children}</AskUserQuestionContext.Provider>
  );
}

/**
 * Returns the AskUserQuestion context if a provider is mounted, otherwise null.
 * Renderers used outside a session view (e.g. source view, tests) get null and
 * fall back to read-only display.
 */
export function useAskUserQuestionContext(): AskUserQuestionContextValue | null {
  return useContext(AskUserQuestionContext);
}
