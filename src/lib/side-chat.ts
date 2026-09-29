import { z } from "zod";

const SideChatMessageSchema = z.strictObject({
  q: z.string(),
  a: z.string(),
});

export type SideChatMessage = z.infer<typeof SideChatMessageSchema>;

export const SideChatRequestSchema = z.strictObject({
  sessionId: z.string().min(1),
  messages: z.array(SideChatMessageSchema),
  question: z.string().trim().min(1),
});

function quote(text: string): string[] {
  return text.split("\n").map((line) => (line === "" ? ">" : `> ${line}`));
}

/**
 * Each side question is a stateless ephemeral fork, so follow-ups carry the
 * earlier side-chat Q/A pairs as a quoted preamble ahead of the new question.
 */
export function buildSideChatPrompt(messages: SideChatMessage[], question: string): string {
  if (messages.length === 0) return question;
  const pairs = messages.map(({ q, a }) => [...quote(`Q: ${q}`), ...quote(`A: ${a}`)]);
  const preamble = pairs.flatMap((lines, index) => (index === 0 ? lines : [">", ...lines]));
  return ["Earlier in this side chat:", "", ...preamble, "", question].join("\n");
}

const BTW_COMMAND = /^\/btw(\s+(.*))?$/s;

/**
 * The composer's `/btw` interception: `/btw <question>` asks the side chat and
 * a bare `/btw` just opens it. Anything else is an ordinary prompt (null).
 */
export function parseBtwCommand(text: string): { question: string } | null {
  const match = BTW_COMMAND.exec(text);
  if (match === null) return null;
  return { question: (match[2] ?? "").trim() };
}

const BRANCH_TITLE_QUESTION_LENGTH = 59;

/** Upstream's auto title for a side answer branched into its own session. */
export function sideChatBranchTitle(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  const cut =
    oneLine.length > BRANCH_TITLE_QUESTION_LENGTH
      ? `${oneLine.slice(0, BRANCH_TITLE_QUESTION_LENGTH)}…`
      : oneLine;
  return `btw: ${cut}`;
}
