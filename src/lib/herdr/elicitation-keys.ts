import {asRecord} from "../narrow";

/**
 * Keys that answer the Claude Code CLI's MCP elicitation dialogs (CLI 2.1.305:
 * the form dialog "MCP server “{server}” requests your input" and the URL
 * dialog "… wants to open a URL"), decoded and driven live in the
 * herdr-elicitation-dialog-keymap spike.
 */

export type ElicitationDecision = "allow" | "always" | "deny" | "cancel";

/** A herdr key name, literal text, or a wait in milliseconds. */
export type ElicitationStep = {key: string} | {text: string} | {pause: number};

export type ElicitationFocus = {stop: "field"; index: number} | {stop: "accept"} | {stop: "decline"};

export interface ElicitationDialog {
	kind: "form" | "url";
	server: string;
	/** The dialog's message, with wrapped lines joined by a space. */
	message: string;
	/** Where the CLI's `❯` sits; null when nothing is focused (pointerless consent). */
	focus: ElicitationFocus | null;
	/** Whether a field's option list is open, where `down`/`esc` act on the list. */
	expanded: boolean;
	fieldCount: number;
}

/**
 * Enter on Accept is silently refused within 150ms of focus arriving there
 * (the CLI's `rH`); 200ms clears it with margin.
 */
const ACCEPT_GUARD_PAUSE_MS = 200;

const TITLE = /^\s*MCP server “(.+)” (requests your input|wants to open a URL)(?: \(task [^)]+\))?\s*$/;
const BUTTONS = /^\s*(❯\s*)?Accept\s+(❯\s*)?Decline\s*$/;
/** A field row: the pointer or a space at column 2, then the marker at column 4. */
const FIELD_ROW = /^ {2}(❯| ) \S/;
const FOOTER = /^\s*Esc to cancel/;

/**
 * Read the elicitation dialog off a pane's visible screen, from the last
 * dialog title down to its Accept/Decline row. Null when no dialog is shown.
 */
export function parseElicitationDialog(screen: string): ElicitationDialog | null {
	const lines = screen.split("\n");
	const start = lines.findLastIndex((line) => TITLE.test(line));
	if (start < 0) return null;
	const title = TITLE.exec(lines[start] ?? "");
	if (title === null) return null;
	const kind = title[2] === "requests your input" ? "form" : "url";

	const body: string[] = [];
	const fields: string[] = [];
	let buttons: RegExpExecArray | null = null;
	for (const line of lines.slice(start + 1)) {
		if (line.trim() === "") continue;
		if (FOOTER.test(line)) break;
		buttons = BUTTONS.exec(line);
		if (buttons !== null) break;
		if (kind === "form" && FIELD_ROW.test(line)) fields.push(line);
		else if (fields.length === 0) body.push(line.trim());
	}
	if (buttons === null) return null;
	// The URL dialog's last line above its buttons is the URL itself.
	const messageLines = kind === "url" ? body.slice(0, -1) : body;

	const fieldIndex = fields.findIndex((line) => line.startsWith("  ❯"));
	const focus = fieldIndex >= 0 ? {stop: "field" as const, index: fieldIndex} : buttonFocus(buttons);
	return {
		kind,
		server: title[1] ?? "",
		message: messageLines.join(" "),
		focus,
		expanded: fields.some((line) => line.trimEnd().endsWith("▾")),
		fieldCount: fields.length,
	};
}

/** Which button carries the `❯` in a matched Accept/Decline row, if either does. */
function buttonFocus(buttons: RegExpExecArray): ElicitationFocus | null {
	if (buttons[1] !== undefined) return {stop: "accept"};
	if (buttons[2] !== undefined) return {stop: "decline"};
	return null;
}

function repeat(key: string, times: number): ElicitationStep[] {
	return Array.from({length: times}, () => ({key}));
}

/** The verdict enum of a permission-style schema, when `verdict` is its first property. */
function verdictEnum(schema: unknown): unknown[] | null {
	const properties = asRecord(asRecord(schema)?.["properties"]);
	if (properties === undefined || Object.keys(properties)[0] !== "verdict") return null;
	const values = asRecord(properties["verdict"])?.["enum"];
	return Array.isArray(values) ? values : null;
}

function focusIndex(dialog: ElicitationDialog): number | null {
	const {focus} = dialog;
	if (focus === null) return null;
	if (focus.stop === "field") return focus.index;
	return focus.stop === "accept" ? dialog.fieldCount : dialog.fieldCount + 1;
}

/**
 * The keys that answer the dialog on screen with a decision, or null when the
 * decision can't be typed safely from where the dialog stands. Deny presses
 * the Decline stop (`decline`), never the verdict's `deny` option, as upstream
 * answers a denied verdict.
 */
export function elicitationSteps(
	schema: unknown,
	decision: ElicitationDecision,
	dialog: ElicitationDialog,
): ElicitationStep[] | null {
	if (decision === "cancel") return dialog.expanded ? [{key: "left"}, {key: "esc"}] : [{key: "esc"}];
	if (dialog.kind === "url") return urlSteps(decision, dialog.focus);
	if (decision === "deny") {
		const index = focusIndex(dialog);
		if (index === null || dialog.expanded) return null;
		return [...repeat("down", dialog.fieldCount + 1 - index), {pause: ACCEPT_GUARD_PAUSE_MS}, {key: "enter"}];
	}
	const focus = dialog.focus;
	if (focus?.stop !== "field" || focus.index !== 0 || dialog.expanded) return null;
	const optionIndex = verdictEnum(schema)?.indexOf(decision === "allow" ? "allow" : "always_allow") ?? -1;
	if (optionIndex < 0) return null;
	return [
		{key: "right"},
		...repeat("down", optionIndex),
		{key: "enter"},
		{pause: ACCEPT_GUARD_PAUSE_MS},
		{key: "enter"},
	];
}

function urlSteps(decision: "allow" | "always" | "deny", focus: ElicitationFocus | null): ElicitationStep[] | null {
	if (decision === "allow") return focus?.stop === "accept" ? [{key: "enter"}] : null;
	if (decision === "always") return null;
	if (focus?.stop === "accept") return [{key: "right"}, {pause: ACCEPT_GUARD_PAUSE_MS}, {key: "enter"}];
	return focus?.stop === "decline" ? [{key: "enter"}] : null;
}
