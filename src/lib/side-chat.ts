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
