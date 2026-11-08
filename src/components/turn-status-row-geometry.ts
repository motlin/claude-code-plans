import type React from "react";

/**
 * Upstream shared-frame `qe`: a TurnStatus row stretches across its column and pads by pad-xs, while its
 * margins pull that padding back out so the label sits on the AssistantMessage text inset and the row ends
 * at its text stop. `--cds-turn-status-hang` is dormant upstream (no caller passes `hangMark`).
 */
export const TURN_STATUS_ROW_GEOMETRY =
	"w-stretch px-xs ms-[calc(var(--cds-assistant-message-text-inset,0px)_-_var(--cds-outset-x,0px)_-_var(--cds-turn-status-hang,0px))] me-[calc(var(--cds-assistant-message-text-stop,0px)_-_var(--cds-outset-x,0px))]";

/** Upstream shared-frame `JG`: the outset the row geometry's margins subtract. */
export const TURN_STATUS_ROW_STYLE = {"--cds-outset-x": "var(--cds-pad-xs)"} as React.CSSProperties;
