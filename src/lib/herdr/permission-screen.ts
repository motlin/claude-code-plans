import type {PermissionDialogDecision} from "../permission-suggestions";
import {OPTION_LINE} from "./dialog-rows";

export type PermissionRowKind = "yes" | "persistent" | "auto" | "no";

export interface PermissionDialogRow {
	kind: PermissionRowKind;
	label: string;
}

/** The rows of the CLI's tool permission dialog as read off the screen. */
export interface PermissionDialogRows {
	/** Whether the rows carry digits; the classifier fallback hides them (`hideIndexes`). */
	indexed: boolean;
	rows: PermissionDialogRow[];
	/** The row with the `❯` marker. */
	focused: number;
}

/**
 * What the dialog on screen offers, the local analogue of upstream's ask flags:
 * `denyFirst` (No first or hidden digits: the classifier fallback's defaultToNo),
 * and whether the persistent and auto rows are there to press.
 */
export interface PermissionDialogShape {
	denyFirst: boolean;
	persistent: boolean;
	auto: boolean;
}

const QUESTION_PREFIX = "Do you want to";
const FOOTER_PREFIX = "Esc to cancel";
/** WebFetch's dialog has no footer; its No row says Esc picks it instead. */
const ESC_SUFFIX = " (esc)";
const AUTO_PREFIX = "Yes, and switch to auto mode";
const NO_LABEL = /^No(,|$)/;
const HIDDEN_ROW = /^\s*(❯\s+)?(\S.*\S|\S)\s*$/;
const FOCUS_MARKER = /^\s*❯/;
const DESCRIPTION_SEPARATOR = /\s+·\s/;
const MAX_INDEXED_ROWS = 9;

function isQuestionLine(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith(QUESTION_PREFIX) && trimmed.endsWith("?");
}

/**
 * Whether the screen shows a tool permission question at all ("Do you want to …?"),
 * so a caller can tell a dialog this parser refuses from a screen with no dialog.
 */
export function showsPermissionQuestion(screen: string): boolean {
	return screen.split("\n").some(isQuestionLine);
}

interface RawRow {
	label: string;
	focused: boolean;
	/** Where the label starts, so a wrapped continuation line can be told from the next text. */
	labelColumn: number;
}

/** The indexed rows, numbered 1…n, with each wrapped continuation line joined onto its row. */
function indexedRows(block: readonly string[]): RawRow[] | null {
	const rows: RawRow[] = [];
	for (const line of block) {
		const match = OPTION_LINE.exec(line);
		if (match !== null) {
			if (Number(match[1]) !== rows.length + 1) return null;
			const label = match[2] ?? "";
			rows.push({label, focused: FOCUS_MARKER.test(line), labelColumn: line.lastIndexOf(label)});
			continue;
		}
		const previous = rows.at(-1);
		if (previous === undefined || line.search(/\S/) < previous.labelColumn) return null;
		previous.label = `${previous.label} ${line.trim()}`;
	}
	return rows;
}

function hiddenRows(block: readonly string[]): RawRow[] | null {
	const rows: RawRow[] = [];
	for (const line of block) {
		const match = HIDDEN_ROW.exec(line);
		if (match === null) return null;
		rows.push({label: match[2] ?? "", focused: match[1] !== undefined, labelColumn: 0});
	}
	return rows;
}

/** The row's label without an inline description (`· auto mode handles these prompts for you`). */
function stripDescription(label: string): string {
	return label.split(DESCRIPTION_SEPARATOR)[0] ?? label;
}

/**
 * Indexed rows classify by position: Yes first, No last, so typed feedback
 * (`No, try x`) still reads as the No row and is never taken for a persistent grant.
 */
function classifyIndexed(labels: readonly string[]): PermissionDialogRow[] | null {
	const last = labels.length - 1;
	const rows: PermissionDialogRow[] = [];
	for (const [index, label] of labels.entries()) {
		if (index === 0) {
			if (!label.startsWith("Yes")) return null;
			rows.push({kind: "yes", label});
		} else if (index === last) {
			if (!NO_LABEL.test(label)) return null;
			rows.push({kind: "no", label});
		} else if (label.startsWith(AUTO_PREFIX)) {
			rows.push({kind: "auto", label});
		} else if (label.startsWith("Yes")) {
			rows.push({kind: "persistent", label});
		} else {
			return null;
		}
	}
	return rows;
}

function classifyHidden(labels: readonly string[]): PermissionDialogRow[] | null {
	const rows: PermissionDialogRow[] = [];
	for (const label of labels) {
		if (label === "Yes" || label.startsWith("Yes, and tell Claude what to do next"))
			rows.push({kind: "yes", label});
		else if (label === "No" || label.startsWith("No, and tell Claude what to do differently")) {
			rows.push({kind: "no", label});
		} else if (label.startsWith(AUTO_PREFIX)) rows.push({kind: "auto", label});
		else if (label.startsWith("Yes")) rows.push({kind: "persistent", label});
		else return null;
	}
	return rows;
}

function countKind(rows: readonly PermissionDialogRow[], kind: PermissionRowKind): number {
	return rows.filter((row) => row.kind === kind).length;
}

/**
 * Read the CLI's tool permission dialog off a pane's visible screen (CLI
 * 2.1.318/2.1.319 `Cht`/`Gi`/`XFn`; `hideIndexes` → `disableSelection "numeric"`).
 * The anchor is the last "Do you want to …?" line. Rows follow it up to the first
 * blank line: numbered 1…n (n ≤ 9), a wrapped row's continuation joined with one
 * space, or, only when no row has a digit, the hidden form. The `Esc to cancel`
 * footer may follow as a prefix; without one the last row must end ` (esc)` (WebFetch).
 * Null for any other shape, including the auto-mode outside-read first prompt,
 * whose rows mean something else.
 */
export function parsePermissionDialog(screen: string): PermissionDialogRows | null {
	const lines = screen.split("\n");
	const anchor = lines.findLastIndex(isQuestionLine);
	if (anchor < 0) return null;

	let start = anchor + 1;
	while (start < lines.length && lines[start]?.trim() === "") start++;
	let end = start;
	while (end < lines.length && lines[end]?.trim() !== "") end++;
	const block = lines.slice(start, end);
	if (block.length === 0) return null;

	const indexed = block.some((line) => OPTION_LINE.test(line));
	const raw = indexed ? indexedRows(block) : hiddenRows(block);
	if (raw === null || raw.length < 2 || (indexed && raw.length > MAX_INDEXED_ROWS)) return null;

	const footer = lines.slice(end).find((line) => line.trim() !== "");
	const hasFooter = footer?.trim().startsWith(FOOTER_PREFIX) === true;
	const labels = raw.map((row) => stripDescription(row.label));
	const lastLabel = labels.at(-1) ?? "";
	if (lastLabel.endsWith(ESC_SUFFIX)) labels[labels.length - 1] = lastLabel.slice(0, -ESC_SUFFIX.length);
	else if (!hasFooter) return null;

	const rows = indexed ? classifyIndexed(labels) : classifyHidden(labels);
	if (rows === null) return null;
	if (countKind(rows, "yes") !== 1 || countKind(rows, "no") !== 1) return null;
	if (countKind(rows, "persistent") > 1 || countKind(rows, "auto") > 1) return null;

	const focusedRows = raw.flatMap((row, index) => (row.focused ? [index] : []));
	const [focused] = focusedRows;
	if (focusedRows.length !== 1 || focused === undefined) return null;
	return {indexed, rows, focused};
}

/** The rows of auto mode's first outside-read prompt, each the digit the screen gives it. */
export interface OutsideReadFirstPrompt {
	kind: "outsideReadFirstPrompt";
	rows: {keepAllowing: number; blockFromNowOn: number; noAskAgain: number; yesAskAgain: number};
}

const OUTSIDE_READ_QUESTION = "Allow this read outside the working directories?";
/** The row labels of the CLI's `ZVt` map (2.1.319). */
const OUTSIDE_READ_ROW_LABELS = {
	keepAllowing: "Yes, and keep allowing any reads outside the working directories",
	blockFromNowOn: "No, and block reads outside the working directories from now on",
	noAskAgain: "No, and ask again next time",
	yesAskAgain: "Yes, but ask again next time",
} as const;

/**
 * Read auto mode's first outside-read prompt (CLI 2.1.319 `UZt`) off the screen:
 * the last `Allow this read outside the working directories?` line, then the
 * numbered rows up to the first blank line, each matched by its exact label.
 * Null unless all four rows are there.
 */
export function parseOutsideReadFirstPrompt(screen: string): OutsideReadFirstPrompt | null {
	const lines = screen.split("\n");
	const anchor = lines.findLastIndex((line) => line.trim() === OUTSIDE_READ_QUESTION);
	if (anchor < 0) return null;
	const digits = new Map<string, number>();
	for (const line of lines.slice(anchor + 1)) {
		if (line.trim() === "") break;
		const match = OPTION_LINE.exec(line);
		if (match === null) return null;
		digits.set(match[2] ?? "", Number(match[1]));
	}
	const keepAllowing = digits.get(OUTSIDE_READ_ROW_LABELS.keepAllowing);
	const blockFromNowOn = digits.get(OUTSIDE_READ_ROW_LABELS.blockFromNowOn);
	const noAskAgain = digits.get(OUTSIDE_READ_ROW_LABELS.noAskAgain);
	const yesAskAgain = digits.get(OUTSIDE_READ_ROW_LABELS.yesAskAgain);
	if (
		keepAllowing === undefined ||
		blockFromNowOn === undefined ||
		noAskAgain === undefined ||
		yesAskAgain === undefined
	) {
		return null;
	}
	return {kind: "outsideReadFirstPrompt", rows: {keepAllowing, blockFromNowOn, noAskAgain, yesAskAgain}};
}

/**
 * The keys that pick `decision` in the dialog on screen, one array per send.
 * Indexed rows take their digit; the hidden form has no digits, so Allow moves
 * from a focused No down onto Yes and presses Enter. Null when the dialog has no
 * such row.
 */
export function permissionDialogSteps(
	dialog: PermissionDialogRows,
	decision: PermissionDialogDecision,
): string[][] | null {
	if (decision === "deny") return [["esc"]];
	const kind: PermissionRowKind = decision === "allow" ? "yes" : "persistent";
	const row = dialog.rows.findIndex((candidate) => candidate.kind === kind);
	if (row < 0) return null;
	if (dialog.indexed) return [[String(row + 1)]];
	if (decision !== "allow") return null;
	if (row === dialog.focused) return [["enter"]];
	if (row === dialog.focused + 1 && dialog.rows[dialog.focused]?.kind === "no") return [["down"], ["enter"]];
	return null;
}

/** The card shape of a dialog read off the screen. */
export function permissionDialogShape(dialog: PermissionDialogRows): PermissionDialogShape {
	return {
		denyFirst: dialog.rows[0]?.kind === "no" || !dialog.indexed,
		persistent: dialog.indexed && dialog.rows.some((row) => row.kind === "persistent"),
		auto: dialog.indexed && dialog.rows.some((row) => row.kind === "auto"),
	};
}
