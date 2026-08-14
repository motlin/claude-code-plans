import type { ResourceOccurrence, TextChunk } from "./session-resources";
import { occurrenceKey, scanSessionContent } from "./session-resources";
import type { SessionLine } from "./transcript";

/**
 * One URL and every message that mentions it, before it is filed under a
 * category. Categorization is the half of link extraction that cannot run on
 * the server: it depends on the host the page is being served from and on the
 * reader's own `linkCategoryRules`. So a whole-session scan collects these and
 * the browser groups them (see `groupSessionLinks`).
 */
export interface CollectedLink {
  url: string;
  label: string;
  occurrences: ResourceOccurrence[];
}

export interface LinkEntry extends CollectedLink {
  categoryId: string;
}

export interface LinkGroup {
  categoryId: string;
  label: string;
  entries: LinkEntry[];
}

export interface SessionLinks {
  groups: LinkGroup[];
  totalCount: number;
}

interface LinkCategory {
  categoryId: string;
  label: string;
}

interface NormalizedUrl {
  url: string;
  parsedUrl?: URL;
}

const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /https?:\/\/[^\s<>"'`\]})\\]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const ISSUE_KEY = /[A-Z][A-Z0-9]+-\d+/;
const GITHUB_ISSUE_OR_PULL = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)(?:\/|$)/;

const BUILT_IN_CATEGORIES: LinkCategory[] = [
  { categoryId: "MyHost", label: "My Host" },
  { categoryId: "GitHub", label: "GitHub" },
  { categoryId: "IssueTracker", label: "Issue Tracker" },
  { categoryId: "GoogleDocs", label: "Google Docs" },
  { categoryId: "GoogleSheets", label: "Google Sheets" },
  { categoryId: "GoogleSlides", label: "Google Slides" },
];
const EXTERNAL_CATEGORY: LinkCategory = { categoryId: "External", label: "External" };

function occurrenceFromChunk(chunk: TextChunk): ResourceOccurrence {
  return {
    source: chunk.source,
    anchorIndex: chunk.anchorIndex,
    ...(chunk.anchorUuid === undefined ? {} : { anchorUuid: chunk.anchorUuid }),
    role: chunk.role,
    ...(chunk.tool === undefined ? {} : { tool: chunk.tool }),
  };
}

function trimUrl(candidate: string): string {
  let trimmed = candidate.replace(TRAILING_PUNCTUATION, "");

  while (trimmed.endsWith(")")) {
    const openingCount = Array.from(trimmed).filter((character) => character === "(").length;
    const closingCount = Array.from(trimmed).filter((character) => character === ")").length;
    if (closingCount <= openingCount) break;
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed;
}

function normalizeUrl(candidate: string): NormalizedUrl {
  try {
    const parsedUrl = new URL(candidate);
    const trackingParameters = Array.from(parsedUrl.searchParams.keys()).filter((parameter) =>
      parameter.toLowerCase().startsWith("utm_"),
    );

    if (trackingParameters.length === 0) return { url: candidate, parsedUrl };

    for (const parameter of trackingParameters) parsedUrl.searchParams.delete(parameter);
    return { url: parsedUrl.toString(), parsedUrl };
  } catch {
    return { url: candidate };
  }
}

function hostnameMatchesGlob(hostname: string, hostPattern: string): boolean {
  const value = hostname.toLowerCase();
  const pattern = hostPattern.toLowerCase();
  let valueIndex = 0;
  let patternIndex = 0;
  let starIndex = -1;
  let starValueIndex = 0;

  while (valueIndex < value.length) {
    const patternCharacter = pattern[patternIndex];
    if (patternCharacter === "?" || patternCharacter === value[valueIndex]) {
      valueIndex += 1;
      patternIndex += 1;
      continue;
    }
    if (patternCharacter === "*") {
      starIndex = patternIndex;
      starValueIndex = valueIndex;
      patternIndex += 1;
      continue;
    }
    if (starIndex === -1) return false;

    patternIndex = starIndex + 1;
    starValueIndex += 1;
    valueIndex = starValueIndex;
  }

  while (pattern[patternIndex] === "*") patternIndex += 1;
  return patternIndex === pattern.length;
}

function isGitHubHost(hostname: string): boolean {
  return (
    hostname === "github.com" || hostname === "gist.github.com" || hostname.startsWith("github.")
  );
}

function categorizeUrl(
  parsedUrl: URL | undefined,
  currentHost: string | undefined,
  userRules: Array<{ label: string; hostPattern: string }>,
): LinkCategory {
  if (parsedUrl === undefined) return EXTERNAL_CATEGORY;

  const { hostname, pathname } = parsedUrl;
  if (currentHost !== undefined && hostname === currentHost) return BUILT_IN_CATEGORIES[0]!;
  if (isGitHubHost(hostname)) return BUILT_IN_CATEGORIES[1]!;
  if (
    hostname.endsWith(".atlassian.net") ||
    hostnameMatchesGlob(hostname, "jira.*") ||
    hostnameMatchesGlob(hostname, "confluence.*")
  ) {
    return BUILT_IN_CATEGORIES[2]!;
  }
  if (hostname === "docs.google.com" && pathname.includes("/document")) {
    return BUILT_IN_CATEGORIES[3]!;
  }
  if (hostname === "docs.google.com" && pathname.includes("/spreadsheets")) {
    return BUILT_IN_CATEGORIES[4]!;
  }
  if (hostname === "docs.google.com" && pathname.includes("/presentation")) {
    return BUILT_IN_CATEGORIES[5]!;
  }

  for (const rule of userRules) {
    if (hostnameMatchesGlob(hostname, rule.hostPattern)) {
      return { categoryId: rule.label, label: rule.label };
    }
  }

  return EXTERNAL_CATEGORY;
}

function getLinkLabel(
  normalizedUrl: string,
  parsedUrl: URL | undefined,
  markdownLabel: string | undefined,
): string {
  if (parsedUrl === undefined) return markdownLabel ?? normalizedUrl;

  const issueKey = parsedUrl.pathname.match(ISSUE_KEY)?.[0];
  if (issueKey !== undefined) return issueKey;

  if (isGitHubHost(parsedUrl.hostname)) {
    const issueOrPull = parsedUrl.pathname.match(GITHUB_ISSUE_OR_PULL);
    if (issueOrPull !== null) return `${issueOrPull[1]}/${issueOrPull[2]}#${issueOrPull[3]}`;
  }

  if (markdownLabel !== undefined) return markdownLabel;
  return `${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`.replace(
    /\/$/,
    "",
  );
}

interface CollectedLinkBuilder {
  url: string;
  label: string;
  occurrences: Map<string, ResourceOccurrence>;
}

/**
 * Every URL the session mentions, with one occurrence per mentioning message.
 *
 * The occurrences are keyed rather than appended: a single tool result can
 * repeat the same URL hundreds of times, and each repeat would otherwise be its
 * own chip pointing at the row the reader is already looking at. On the largest
 * measured session the de-duplicated payload is a fraction of the raw one.
 */
export function collectSessionLinks(lines: SessionLine[]): CollectedLink[] {
  const links = new Map<string, CollectedLinkBuilder>();

  const addUrl = (
    candidate: string,
    markdownLabel: string | undefined,
    occurrence: ResourceOccurrence,
  ) => {
    const normalized = normalizeUrl(trimUrl(candidate));
    const existing = links.get(normalized.url);
    if (existing !== undefined) {
      existing.occurrences.set(occurrenceKey(occurrence), occurrence);
      return;
    }

    links.set(normalized.url, {
      url: normalized.url,
      label: getLinkLabel(normalized.url, normalized.parsedUrl, markdownLabel),
      occurrences: new Map([[occurrenceKey(occurrence), occurrence]]),
    });
  };

  for (const chunk of scanSessionContent(lines)) {
    for (const match of chunk.text.matchAll(MARKDOWN_LINK)) {
      addUrl(match[2]!, match[1]!, occurrenceFromChunk(chunk));
    }

    const textWithoutMarkdownLinks = chunk.text.replace(MARKDOWN_LINK, " ");
    for (const match of textWithoutMarkdownLinks.matchAll(BARE_URL)) {
      addUrl(match[0], undefined, occurrenceFromChunk(chunk));
    }
  }

  return Array.from(links.values(), (link) => ({
    url: link.url,
    label: link.label,
    occurrences: Array.from(link.occurrences.values()),
  }));
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** File collected URLs under their categories, in the drawer's display order. */
export function groupSessionLinks(
  links: CollectedLink[],
  currentHost: string | undefined,
  userRules: Array<{ label: string; hostPattern: string }>,
): SessionLinks {
  const entries = links.map(
    (link): LinkEntry => ({
      ...link,
      categoryId: categorizeUrl(parseUrl(link.url), currentHost, userRules).categoryId,
    }),
  );

  const categoryOrder = [
    ...BUILT_IN_CATEGORIES,
    ...userRules.map((rule) => ({ categoryId: rule.label, label: rule.label })),
    EXTERNAL_CATEGORY,
  ];
  const groups: LinkGroup[] = [];
  const emittedCategories = new Set<string>();

  for (const category of categoryOrder) {
    if (emittedCategories.has(category.categoryId)) continue;
    emittedCategories.add(category.categoryId);

    const categoryEntries = entries.filter((entry) => entry.categoryId === category.categoryId);
    if (categoryEntries.length > 0) groups.push({ ...category, entries: categoryEntries });
  }

  return { groups, totalCount: entries.length };
}

export function extractSessionLinks(
  lines: SessionLine[],
  currentHost: string | undefined,
  userRules: Array<{ label: string; hostPattern: string }>,
): SessionLinks {
  return groupSessionLinks(collectSessionLinks(lines), currentHost, userRules);
}
