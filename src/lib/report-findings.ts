/*
 * claude.ai/code's ReportFindings input parser (ca8b34310 `up`/`lp`/`sp`/`cp`) and the "Code review" transcript
 * card's pure helpers (c3fef5c6f `eC`/`XS`/`ZS`/`QS`). The parser is lenient: it reads any input shape and keeps
 * only the fields it understands, so a card still draws when the strict schema rejects an input.
 */

export const REVIEW_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReviewLevel = (typeof REVIEW_LEVELS)[number];

/** Upstream `Jv`: the effort label for `/code-review {level}`. */
const REVIEW_LEVEL_LABELS =
{
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
} satisfies Record<ReviewLevel, string>;

export type ReportedFindingVerdict = "CONFIRMED" | "PLAUSIBLE";
export type ReportedFindingOutcome = "fixed" | "skipped" | "no_change_needed";

export interface ParsedFinding
{
	file: string;
	summary: string;
	short_summary: string | undefined;
	line: number | undefined;
	failure_scenario: string | undefined;
	category: string | undefined;
	verdict: ReportedFindingVerdict | undefined;
	outcome: ReportedFindingOutcome | undefined;
}

export interface ParsedReportFindings
{
	level: ReviewLevel | undefined;
	findings: ParsedFinding[];
}

/** A transcript finding's live status in the Changes store (upstream `findingStatusBySession`). */
export type ReviewFindingStatus = "open" | "fixing" | "addressed" | "unchanged" | "dismissed";

/** Upstream `G`: what the card can still do with its findings. */
export type ReviewCardState = "empty" | "actionable" | "applying" | "terminal";

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null;
}

function isReviewLevel(value: unknown): value is ReviewLevel
{
	return (REVIEW_LEVELS as readonly unknown[]).includes(value);
}

/** Upstream `sp`: a trimmed failure scenario, with blank and "-" meaning none. */
function failureScenario(value: unknown): string | undefined
{
	const trimmed = typeof value === "string" ? value.trim() : undefined;
	return trimmed === undefined || trimmed === "" || trimmed === "-" ? undefined : trimmed;
}

/** Upstream `cp`: "null-deref" -> "Null deref", at most 40 characters. */
function category(value: unknown): string | undefined
{
	if (typeof value !== "string") return undefined;
	const words = value.replace(/[-_]+/g, " ").trim();
	if (words.length === 0) return undefined;
	return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 40);
}

/** Upstream `lp`: one finding, or undefined without a string `file` and `summary`. */
function parseFinding(value: unknown): ParsedFinding | undefined
{
	if (!isRecord(value)) return undefined;
	const {file, summary} = value;
	if (typeof file !== "string" || typeof summary !== "string") return undefined;
	const shortSummary = value["short_summary"];
	const {line, verdict, outcome} = value;
	return {
		file,
		summary,
		short_summary: typeof shortSummary === "string" && shortSummary.trim().length > 0 ? shortSummary : undefined,
		line: typeof line === "number" ? line : undefined,
		failure_scenario: failureScenario(value["failure_scenario"]),
		category: category(value["category"]),
		verdict: verdict === "CONFIRMED" || verdict === "PLAUSIBLE" ? verdict : undefined,
		outcome: outcome === "fixed" || outcome === "skipped" || outcome === "no_change_needed" ? outcome : undefined,
	};
}

/** Upstream `up`: undefined when `findings` is not an array, or when it has findings and none is valid. */
export function parseReportFindings(input: unknown): ParsedReportFindings | undefined
{
	if (!isRecord(input) || !Array.isArray(input["findings"])) return undefined;
	const raw: readonly unknown[] = input["findings"];
	const findings = raw.map(parseFinding).filter((finding) => finding !== undefined);
	if (raw.length > 0 && findings.length === 0) return undefined;
	return {
		level: isReviewLevel(input["level"]) ? input["level"] : undefined,
		findings,
	};
}

/** Upstream `pj`: a finding carries an `outcome`, so the call is a fix report, not a review. */
export function hasFindingOutcomes(input: unknown): boolean
{
	if (!isRecord(input)) return false;
	const findings = input["findings"];
	return Array.isArray(findings) && findings.some((finding) => isRecord(finding) && finding["outcome"] !== undefined);
}

/** Upstream `YS`: "file" or "file:line". */
export function findingLocation(finding: {file: string; line?: number | undefined}): string
{
	return finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
}

/** Upstream `$S`: `text` without trailing characters from `chars`. */
function trimEnd(text: string, chars: string): string
{
	let end = text.length;
	while (end > 0 && chars.includes(text[end - 1] ?? "")) end--;
	return text.slice(0, end);
}

const SUMMARY_MAX = 72;

/** Upstream `eC`: the short summary, else the summary cut at a word under 72 characters with an ellipsis. */
export function findingRowSummary(finding: {summary: string; short_summary?: string | undefined}): string
{
	if (finding.short_summary) return finding.short_summary;
	const text = trimEnd(finding.summary, ".!? \t\n\r");
	if (text.length <= SUMMARY_MAX) return text;
	const head = text.slice(0, SUMMARY_MAX);
	const space = head.lastIndexOf(" ");
	return `${trimEnd(space > 0 ? head.slice(0, space) : head, " \t\n\r.,;:!?")}…`;
}

export interface FindingFileGroup<
	T extends
	{
		file: string;
	},
>
{
	file: string;
	label: string;
	entries:
	{
		finding: T;
		index: number;
	}[];
}

/** Upstream `ZS`: the shortest trailing path suffix no other file shares, else the whole path. */
function uniqueSuffix(file: string, files: readonly string[]): string
{
	const parts = (path: string) => path.split(/[\\/]/);
	const own = parts(file);
	for (let take = 1; take < own.length; take++)
	{
		const suffix = own.slice(-take).join("/");
		if (suffix !== "" && files.every((other) => other === file || parts(other).slice(-take).join("/") !== suffix))
			return suffix;
	}
	return file;
}

/** Upstream `XS`: findings grouped by file in first-seen order, each keeping its index in the call. */
export function groupFindingsByFile<
	T extends
	{
		file: string;
	},
>(findings: readonly T[]): FindingFileGroup<T>[]
{
	const byFile = new Map<string, FindingFileGroup<T>["entries"]>();
	findings.forEach((finding, index) =>
	{
		const entries = byFile.get(finding.file);
		const entry =
		{
			finding,
			index,
		};
		if (entries) entries.push(entry);
		else byFile.set(finding.file, [entry]);
	});
	const files = [...byFile.keys()];
	return Array.from(byFile, ([file, entries]) => (
	{
		file,
		label: uniqueSuffix(file, files),
		entries,
	}));
}

function findingCount(count: number): string
{
	return `${count} ${count === 1 ? "finding" : "findings"}`;
}

/** Upstream `QS`: the card header's summary text. */
export function reviewSummaryText(level: ReviewLevel | undefined, count: number): string
{
	if (level === undefined) return count === 0 ? "No issues found" : findingCount(count);
	return `${REVIEW_LEVEL_LABELS[level]} effort, ${count === 0 ? "no issues found" : findingCount(count)}`;
}

/** Upstream `G`, first match wins: no findings, any open, any fixing, else terminal. */
export function reviewCardState(
	ids: readonly string[],
	statuses: Readonly<Record<string, ReviewFindingStatus>>,
): ReviewCardState
{
	if (ids.length === 0) return "empty";
	const status = (id: string) => statuses[id] ?? "open";
	if (ids.some((id) => status(id) === "open")) return "actionable";
	if (ids.some((id) => status(id) === "fixing")) return "applying";
	return "terminal";
}

/** Upstream `De`: the sr-only progress line. */
export function reviewProgressAnnouncement(fixing: number, state: ReviewCardState): string
{
	if (fixing > 0) return `${fixing} ${fixing === 1 ? "fix" : "fixes"} in progress`;
	return state === "terminal" ? "Review complete" : "";
}
