/**
 * A 4,000-character ceiling keeps the injected brief near 1,000 tokens while
 * remaining deterministic without coupling the server to a model tokenizer.
 */
export const CONTEXT_BRIEF_MAX_CHARACTERS = 4_000;
export const CONTEXT_BRIEF_APPROXIMATE_TOKEN_BUDGET = 1_000;
const CONTEXT_BRIEF_TASK_LIMIT = 15;
const CONTEXT_BRIEF_PLAN_LIMIT = 5;
const CONTEXT_BRIEF_DECISION_LIMIT = 15;

const ENTRY_TEXT_LIMIT = 72;
const PROJECT_NAME_LIMIT = 72;
const DECISION_KEYWORD_LIMIT = 32;
const DECISION_KEYWORD_TERM_LIMIT = 4;

const DECISION_KEYWORD_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "decision",
  "for",
  "from",
  "in",
  "instead",
  "is",
  "of",
  "on",
  "or",
  "prior",
  "should",
  "the",
  "to",
  "use",
  "using",
  "versus",
  "vs",
  "with",
]);

export interface ContextBriefInput {
  projectName: string;
  openTaskTitles: readonly string[];
  recentPlanTitles: readonly string[];
  decisionTitles: readonly string[];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, limit: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

function decisionKeywordBase(title: string): string {
  const terms = normalizeText(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  const meaningfulTerms = (terms ?? [])
    .filter((term) => term.length > 1 && !DECISION_KEYWORD_STOP_WORDS.has(term))
    .slice(0, DECISION_KEYWORD_TERM_LIMIT);
  const keyword = meaningfulTerms.join("-") || "decision";
  return keyword.slice(0, DECISION_KEYWORD_LIMIT).replace(/-+$/, "");
}

function buildDecisionIndex(titles: readonly string[]): string[] {
  const usedKeywords = new Set<string>();
  const entries: string[] = [];

  for (const rawTitle of titles) {
    if (entries.length === CONTEXT_BRIEF_DECISION_LIMIT) break;
    const title = truncateText(rawTitle, ENTRY_TEXT_LIMIT);
    if (!title) continue;

    const base = decisionKeywordBase(title);
    let keyword = base;
    let suffix = 2;
    while (usedKeywords.has(keyword)) {
      const suffixText = `-${suffix}`;
      keyword = `${base.slice(0, DECISION_KEYWORD_LIMIT - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    usedKeywords.add(keyword);
    entries.push(`- ${keyword} -> ${title}`);
  }

  return entries;
}

/** Build the complete, bounded plain-text payload injected by SessionStart. */
export function buildContextBrief(input: ContextBriefInput): string {
  const projectName = truncateText(input.projectName, PROJECT_NAME_LIMIT);
  const taskLines = input.openTaskTitles
    .slice(0, CONTEXT_BRIEF_TASK_LIMIT)
    .map((title) => truncateText(title, ENTRY_TEXT_LIMIT))
    .filter(Boolean)
    .map((title) => `- ${title}`);
  const planLines = input.recentPlanTitles
    .slice(0, CONTEXT_BRIEF_PLAN_LIMIT)
    .map((title) => truncateText(title, ENTRY_TEXT_LIMIT))
    .filter(Boolean)
    .map((title) => `- ${title}`);
  const decisionLines = buildDecisionIndex(input.decisionTitles);

  const lines = [
    `### Context for ${projectName}`,
    "",
    `Open tasks (${taskLines.length}):`,
    ...(taskLines.length > 0 ? taskLines : ["- None"]),
    "",
    "Recent plans:",
    ...(planLines.length > 0 ? planLines : ["- None"]),
    "",
    "Prior decisions (ask if relevant):",
    ...(decisionLines.length > 0 ? decisionLines : ["- None indexed"]),
  ];
  const brief = `${lines.join("\n")}\n`;

  if (brief.length > CONTEXT_BRIEF_MAX_CHARACTERS) {
    throw new Error("Context brief exceeded its deterministic character budget");
  }
  return brief;
}
