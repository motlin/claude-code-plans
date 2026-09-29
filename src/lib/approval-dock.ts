import { z } from "zod";

import {
  answerForQuestion,
  makeInitialDraft,
  normalizeQuestions,
  type QuestionDraft,
  type QuestionLike,
} from "./ask-user-question";

export interface PendingQuestion {
  toolUseId: string;
  questions: QuestionLike[];
}

const BlockSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  tool_use_id: z.string().optional(),
});

const RecordSchema = z.object({
  type: z.string(),
  isSidechain: z.boolean().optional(),
  message: z.object({ content: z.union([z.string(), z.array(BlockSchema)]).optional() }).optional(),
});

export interface PendingToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** The main thread's last assistant tool_use when it has no tool_result yet, or null. */
export function findLastPendingToolUse(records: readonly unknown[]): PendingToolUse | null {
  let last: z.infer<typeof BlockSchema> | null = null;
  const answered = new Set<string>();
  for (const raw of records) {
    const parsed = RecordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.isSidechain === true) continue;
    const content = parsed.data.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (parsed.data.type === "assistant" && block.type === "tool_use") last = block;
      if (block.type === "tool_result" && block.tool_use_id !== undefined) {
        answered.add(block.tool_use_id);
      }
    }
  }
  if (last?.id === undefined || last.name === undefined || answered.has(last.id)) return null;
  return { id: last.id, name: last.name, input: last.input ?? {} };
}

/**
 * The main thread's last assistant tool_use when it is an AskUserQuestion that
 * has no tool_result yet, or null. This is the question upstream docks above
 * the composer as a "needs input" card.
 */
export function findPendingAskUserQuestion(records: readonly unknown[]): PendingQuestion | null {
  const pending = findLastPendingToolUse(records);
  if (pending?.name !== "AskUserQuestion") return null;
  const questions = normalizeQuestions(pending.input);
  return questions === null ? null : { toolUseId: pending.id, questions };
}

export interface ApprovalDockState {
  index: number;
  drafts: QuestionDraft[];
  collapsed: boolean;
  dismissed: boolean;
}

export type ApprovalDockAction =
  | { type: "select"; option: number }
  | { type: "selectOther" }
  | { type: "setOtherText"; text: string }
  | { type: "next" }
  | { type: "skip" }
  | { type: "goto"; index: number }
  | { type: "toggleCollapsed" }
  | { type: "dismiss" };

export function initialApprovalDockState(questions: readonly QuestionLike[]): ApprovalDockState {
  return {
    index: 0,
    drafts: questions.map(() => makeInitialDraft()),
    collapsed: false,
    dismissed: false,
  };
}

function withDraft(
  state: ApprovalDockState,
  update: (draft: QuestionDraft) => QuestionDraft,
): ApprovalDockState {
  return {
    ...state,
    drafts: state.drafts.map((draft, i) => (i === state.index ? update(draft) : draft)),
  };
}

function clampIndex(index: number, questions: readonly QuestionLike[]): number {
  return Math.max(0, Math.min(index, questions.length - 1));
}

/** Whether the current question has an answer, which Next requires. */
export function currentAnswered(
  questions: readonly QuestionLike[],
  state: ApprovalDockState,
): boolean {
  const question = questions[state.index];
  const draft = state.drafts[state.index];
  return (
    question !== undefined && draft !== undefined && answerForQuestion(question, draft) !== null
  );
}

export function approvalDockReducer(
  state: ApprovalDockState,
  action: ApprovalDockAction,
  questions: readonly QuestionLike[],
): ApprovalDockState {
  const question = questions[state.index];
  switch (action.type) {
    case "select": {
      const label = question?.options[action.option]?.label;
      if (label === undefined) return state;
      return withDraft(state, (draft) => {
        if (!question?.multiSelect) {
          return { selected: new Set([label]), otherText: draft.otherText, useOther: false };
        }
        const selected = new Set(draft.selected);
        if (selected.has(label)) selected.delete(label);
        else selected.add(label);
        return { selected, otherText: draft.otherText, useOther: false };
      });
    }
    case "selectOther":
      return withDraft(state, (draft) => ({
        selected: new Set(),
        otherText: draft.otherText,
        useOther: true,
      }));
    case "setOtherText":
      return withDraft(state, () => ({
        selected: new Set(),
        otherText: action.text,
        useOther: true,
      }));
    case "next":
      if (!currentAnswered(questions, state)) return state;
      return { ...state, index: clampIndex(state.index + 1, questions) };
    case "skip":
      return {
        ...withDraft(state, () => makeInitialDraft()),
        index: clampIndex(state.index + 1, questions),
      };
    case "goto":
      return { ...state, index: clampIndex(action.index, questions) };
    case "toggleCollapsed":
      return { ...state, collapsed: !state.collapsed };
    case "dismiss":
      return { ...state, dismissed: true };
  }
}

/** The `/api/answer-question` answers, one per question, blank for skipped questions. */
export function approvalDockAnswers(
  questions: readonly QuestionLike[],
  state: ApprovalDockState,
): Array<{ question: string; answer: string }> {
  return questions.map((question, i) => ({
    question: question.question,
    answer: answerForQuestion(question, state.drafts[i] ?? makeInitialDraft()) ?? "",
  }));
}
