import type {ApprovalLeadingAllow} from "./approval-leading-allow";
import type {PermissionDialogShape} from "./herdr/permission-screen";
import {type LaunchPermissionMode, shiftTabCount} from "./launch-options";

/*
 * Upstream's "Allow and switch to Auto" on the tool permission card: the offer flag (cf6ae6197 `_i`, now `yi`),
 * the card's offer gate (cc32965c2 `ei`, now `ri`), its menu specs (`la`) and row (`ea`, now `aa`).
 */

/** Upstream `OE8niF`. */
export const AUTO_SWITCH_LABEL = "Allow and switch to Auto";
/** Upstream `/AOfoe`. */
export const AUTO_SWITCH_DESCRIPTION = "Auto reviews the rest of this session.";

export interface AutoSwitchOfferInput
{
	/** The session's mode, as the chin reads it. */
	mode: string;
	/** Modes in the CLI's shift+tab cycle for this session. */
	availableModes: readonly LaunchPermissionMode[];
	/** A live herdr pane that accepts writes. */
	canAnswer: boolean;
	/** Upstream's read gate (`lr`): unmet hides the row. */
	readGated: boolean;
	/** A verdict elicitation answers through its own dialog, which has no auto row. */
	elicitation: boolean;
	/** The terminal's dialog, the local analogue of upstream's ask flags; undefined when there's none to read. */
	dialog: PermissionDialogShape | "unknown" | undefined;
}

/**
 * Whether the card offers "Allow and switch to Auto": Manual or Accept edits with Auto in the cycle, an answerable
 * card that isn't read-gated, and a dialog read off the screen that isn't deny-first (upstream's `!vn`; an unknown
 * shape is askFlagsUnknown, drawn as defaultToNo with no auto row). The CLI's own "Yes, and switch to auto mode" row
 * (`dialog.auto`) makes the switch one press; without it the server allows once and steps the mode with shift+tab,
 * which needs the current mode in the cycle.
 */
export function autoSwitchOffered({
	mode,
	availableModes,
	canAnswer,
	readGated,
	elicitation,
	dialog,
}: AutoSwitchOfferInput): boolean
{
	if (mode !== "default" && mode !== "acceptEdits") return false;
	if (!availableModes.includes("auto") || !canAnswer || readGated || elicitation) return false;
	if (dialog === undefined || dialog === "unknown" || dialog.denyFirst) return false;
	return dialog.auto || shiftTabCount(mode, "auto", availableModes) !== null;
}

export type AllowMenuItem = "once" | "persistent" | "auto";

/**
 * The "More allow options" rows in upstream's order: the non-leading allow option, then the auto row. Without a
 * persistent option the menu holds the auto row alone, and none at all when it isn't offered.
 */
export function allowMenuItems({
	persistent,
	lead,
	autoOffered,
}: {
	persistent: boolean;
	lead: ApprovalLeadingAllow;
	autoOffered: boolean;
}): AllowMenuItem[]
{
	const items: AllowMenuItem[] = persistent ? [lead === "always" ? "once" : "persistent"] : [];
	return autoOffered ? [...items, "auto"] : items;
}
