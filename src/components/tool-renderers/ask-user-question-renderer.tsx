import { Fragment, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { ToolRendererProps } from "./types";
import { useAskUserQuestionContext } from "../ask-user-question-context";
import { MarkdownArticle } from "../markdown-article";
import {
  answerForQuestion,
  describeAskUserQuestionResult,
  makeInitialDraft,
  normalizeQuestions,
  parseAnswerResult,
  type AskUserQuestionStatus,
  type ParsedAnswer,
  type QuestionDraft,
  type QuestionLike,
} from "../../lib/ask-user-question";

/**
 * Upstream's list-in-card idiom: a hairline-outlined card that clips its rows,
 * separates them with a divider, and pays their padding from the container so
 * every row is full-bleed and content-height.
 */
const CARD_SHELL =
  "flex flex-col card-outline rounded-r6 overflow-clip divide-y divide-t3 [&>*]:px-p7 [&>*]:py-p6";

function IndexBadge({ children, focused }: { children: ReactNode; focused?: boolean }) {
  return (
    <span
      className={`relative flex size-[30px] shrink-0 items-center justify-center rounded-r4 overflow-hidden text-body ${
        focused ? "bg-t4 text-primary" : "bg-t2 text-secondary"
      }`}
    >
      {children}
    </span>
  );
}

function ReadOnlyAnswer({
  label,
  description,
  index,
  notes,
}: {
  label: string;
  description?: string | undefined;
  index: number;
  notes: string | null | undefined;
}) {
  return (
    <div className="flex w-full items-center gap-g6 text-left bg-t2">
      <IndexBadge focused>{index}</IndexBadge>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-body text-primary truncate">{label}</span>
        {description && (
          <span className="text-footnote text-secondary truncate">{description}</span>
        )}
        {notes !== null && notes !== undefined && notes.trim() !== "" && (
          <NotesLine notes={notes} />
        )}
      </div>
    </div>
  );
}

function ReadOnlyOption({
  label,
  description,
  index,
}: {
  label: string;
  description?: string | undefined;
  index: number;
}) {
  return (
    <div className="flex w-full items-center gap-g6 text-left opacity-50">
      <IndexBadge>{index}</IndexBadge>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-body text-primary truncate">{label}</span>
        {description && (
          <span className="text-footnote text-secondary truncate">{description}</span>
        )}
      </div>
    </div>
  );
}

function NotesLine({ notes }: { notes: string }) {
  return (
    <p className="text-footnote text-secondary italic whitespace-pre-wrap">
      <span className="text-primary">Notes: </span>
      {notes}
    </p>
  );
}

/**
 * True when the user's note adds information beyond the answer value itself.
 * When the user picks 'Other' and types a custom answer, Claude Code echoes
 * the same string in both fields; suppress that redundant duplicate.
 */
function notesAddInformation(notes: string | null | undefined, answerValue: string): boolean {
  if (notes === null || notes === undefined) return false;
  const trimmed = notes.trim();
  return trimmed !== "" && trimmed !== answerValue.trim();
}

function ReadOnlyOtherAnswer({ value, notes }: { value: string; notes?: string | null }) {
  return (
    <div className="flex w-full items-center gap-g6 text-left bg-t2">
      <IndexBadge focused>
        <PencilIcon />
      </IndexBadge>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-body text-primary truncate">{value}</span>
        {notesAddInformation(notes, value) && <NotesLine notes={notes!} />}
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor">
      <path d="M227.31,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.69,147.31,64l24-24L216,84.69Z" />
    </svg>
  );
}

/**
 * Render a question after it has been answered (or when no submission UI is
 * active). Uses the parsed answer (when available) to figure out which option
 * was chosen and whether to surface supplementary user notes.
 *
 * Emits its blocks as siblings so the enclosing card divides and pads every row
 * itself, matching upstream's list-in-card idiom.
 */
function AnsweredQuestion({
  question,
  header,
  options,
  parsed,
}: QuestionLike & { parsed?: ParsedAnswer | undefined }) {
  const answerValue = parsed?.answer.trim() ?? "";
  const matchesAny = options.some((opt) => opt.label === answerValue);
  const isOther = answerValue.length > 0 && !matchesAny;
  const notes = parsed?.notes;

  return (
    <>
      <div>
        {header && <p className="text-footnote text-secondary mb-g3">{header}</p>}
        <MarkdownArticle markdown={question} />
      </div>
      {options.map((opt, optionIndex) =>
        opt.label === answerValue ? (
          <ReadOnlyAnswer
            key={opt.label}
            label={opt.label}
            description={opt.description}
            index={optionIndex + 1}
            notes={notes}
          />
        ) : (
          <ReadOnlyOption
            key={opt.label}
            label={opt.label}
            description={opt.description}
            index={optionIndex + 1}
          />
        ),
      )}
      {isOther && <ReadOnlyOtherAnswer value={answerValue} notes={notes ?? null} />}
    </>
  );
}

function StatusLine({ status }: { status: AskUserQuestionStatus }) {
  return (
    <div className="text-body text-extended-pink">
      <div>{status.text}</div>
      {status.detail && <div className="text-secondary whitespace-pre-wrap">{status.detail}</div>}
    </div>
  );
}

/**
 * Interactive answer form rendered when the session is active and the question
 * is still pending. Renders the same options as the read-only view but lets
 * the user pick one (or many, if multiSelect) plus a free-text 'Other' field.
 */
function AnswerForm({
  questions,
  onSubmit,
}: {
  questions: QuestionLike[];
  onSubmit: (answers: Array<{ question: string; answer: string }>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() =>
    questions.map(() => makeInitialDraft()),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completed = questions.every((q, i) => answerForQuestion(q, drafts[i]!) !== null);

  function updateDraft(index: number, mutator: (draft: QuestionDraft) => QuestionDraft) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? mutator(d) : d)));
  }

  function toggleOption(index: number, label: string) {
    const question = questions[index]!;
    updateDraft(index, (draft) => {
      const next: QuestionDraft = {
        selected: new Set(draft.selected),
        otherText: draft.otherText,
        useOther: false,
      };
      if (question.multiSelect) {
        if (next.selected.has(label)) {
          next.selected.delete(label);
        } else {
          next.selected.add(label);
        }
      } else {
        next.selected = new Set([label]);
      }
      return next;
    });
  }

  function selectOther(index: number) {
    updateDraft(index, (draft) => ({
      selected: new Set(),
      otherText: draft.otherText,
      useOther: true,
    }));
  }

  function setOtherText(index: number, value: string) {
    updateDraft(index, (draft) => ({
      selected: draft.selected,
      otherText: value,
      useOther: true,
    }));
  }

  async function handleSubmit() {
    if (!completed || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const answers = questions.map((q, i) => ({
        question: q.question,
        answer: answerForQuestion(q, drafts[i]!) ?? "",
      }));
      await onSubmit(answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer");
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const answers = questions.map((q) => ({
        question: q.question,
        answer: "",
      }));
      await onSubmit(answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to skip");
      setSubmitting(false);
    }
  }

  return (
    <div className={CARD_SHELL}>
      {questions.map((q, index) => {
        const draft = drafts[index]!;
        const isMulti = q.multiSelect ?? false;
        return (
          <Fragment key={index}>
            <div className="flex items-start gap-g6">
              <div className="flex-1 min-w-0">
                <MarkdownArticle markdown={q.question} />
              </div>
              {q.header && (
                <span className="text-footnote text-secondary shrink-0">{q.header}</span>
              )}
            </div>
            {q.options.map((opt, optionIndex) => {
              const selected = draft.selected.has(opt.label) && !draft.useOther;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => toggleOption(index, opt.label)}
                  disabled={submitting}
                  className={`flex w-full items-center gap-g6 text-left cursor-pointer transition-colors ${
                    selected ? "bg-t2" : "hover:bg-t1"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {isMulti ? (
                    <div className="flex size-[30px] shrink-0 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selected}
                        readOnly
                        className="w-5 h-5 pointer-events-none"
                      />
                    </div>
                  ) : (
                    <IndexBadge focused={selected}>{optionIndex + 1}</IndexBadge>
                  )}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span
                      className={`text-body truncate ${selected ? "text-primary" : "text-secondary"}`}
                    >
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="text-footnote text-secondary truncate">
                        {opt.description}
                      </span>
                    )}
                  </div>
                  {selected && !isMulti && (
                    <span className="text-secondary text-body shrink-0" aria-hidden="true">
                      ⏎
                    </span>
                  )}
                </button>
              );
            })}
            <div
              className={`flex w-full items-center gap-g6 text-left cursor-text ${
                draft.useOther ? "bg-t2" : "hover:bg-t1"
              }`}
              onClick={() => selectOther(index)}
            >
              {isMulti ? (
                <div className="flex size-[30px] shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={draft.useOther && draft.otherText.trim().length > 0}
                    readOnly
                    className="w-5 h-5 pointer-events-none"
                  />
                </div>
              ) : (
                <IndexBadge focused={draft.useOther}>
                  <PencilIcon />
                </IndexBadge>
              )}
              <input
                type="text"
                value={draft.otherText}
                onChange={(e) => setOtherText(index, e.target.value)}
                onFocus={() => selectOther(index)}
                disabled={submitting}
                placeholder="Type your answer"
                className="flex-1 min-w-0 w-full bg-transparent text-body text-primary placeholder:text-secondary outline-none ring-0 border-0 shadow-none focus:ring-0 focus:!outline-none focus:border-0 focus:shadow-none"
              />
            </div>
            {isMulti && (
              <p className="text-footnote text-secondary italic">Select one or more options.</p>
            )}
          </Fragment>
        );
      })}
      {error && <div className="text-footnote text-extended-pink">{error}</div>}
      <div className="flex items-center justify-end gap-g6">
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="inline-flex items-center gap-g3 rounded-r4 card-outline px-p7 py-p5 text-footnote font-medium text-secondary hover:bg-t1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!completed || submitting}
          className="inline-flex items-center gap-g3 rounded-r4 bg-accent-100 px-p7 py-p5 text-footnote font-medium text-white hover:bg-accent-100/80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </div>
    </div>
  );
}

export function AskUserQuestionRenderer({ toolCall }: ToolRendererProps) {
  const ctx = useAskUserQuestionContext();
  const questions = normalizeQuestions(toolCall.input);
  const { result } = toolCall;
  const isPending = result === undefined;
  const canAnswer = ctx?.isSessionActive === true && isPending && questions !== null;

  if (canAnswer) {
    return (
      <AnswerForm
        questions={questions}
        onSubmit={(answers) => ctx.submitAnswer({ toolUseId: toolCall.id, answers })}
      />
    );
  }

  const status = describeAskUserQuestionResult(result);

  if (!questions) {
    const singleQuestion = (toolCall.input["question"] as string) ?? "";
    return (
      <div className={CARD_SHELL}>
        <div>
          <MarkdownArticle markdown={singleQuestion} />
        </div>
        {status && <StatusLine status={status} />}
        {!status && result !== undefined && (
          <p className="text-body text-secondary whitespace-pre-wrap">{result}</p>
        )}
      </div>
    );
  }

  const parsed = result !== undefined ? parseAnswerResult(result, questions) : null;
  const parsedByQuestion = new Map<string, ParsedAnswer>();
  if (parsed) {
    for (const entry of parsed) {
      parsedByQuestion.set(entry.question, entry);
    }
  }

  // Parsing can fail when the result text predates the canonical envelope
  // or has an unexpected shape. Fall back to displaying the raw text so we
  // don't silently lose information.
  const showRawFallback = result !== undefined && parsed === null && status === null;

  return (
    <div className={CARD_SHELL}>
      {questions.map((q, i) => (
        <AnsweredQuestion
          key={i}
          question={q.question}
          {...(q.header ? { header: q.header } : {})}
          options={q.options}
          parsed={parsedByQuestion.get(q.question)}
        />
      ))}
      {status && <StatusLine status={status} />}
      {showRawFallback && <p className="text-body text-secondary whitespace-pre-wrap">{result}</p>}
    </div>
  );
}
