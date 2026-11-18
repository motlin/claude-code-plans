/**
 * Upstream's cds Dialog body (`Xn`) minus its padding: `isolate flex min-h-0 flex-1 flex-col overflow-y-auto
 * scroll-fade-y rounded-[inherit] p-xl break-words`. Each dialog appends its own pad.
 */
export const DIALOG_BODY_CLASS =
	"isolate flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y rounded-[inherit] break-words";

/**
 * Upstream's cds Dialog popup prefix (`bE`): a transparent `::after` layer that fades to the backdrop colour over the
 * popup while Base UI marks it `data-nested-dialog-open`, so a dialog opened from inside this one dims its parent.
 */
export const DIALOG_NESTED_SCRIM_CLASS =
	"after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-backdrop after:opacity-0 after:z-50 after:transition-opacity after:duration-200 after:ease-[cubic-bezier(0.165,0.84,0.44,1)] data-[nested-dialog-open]:after:opacity-100";

/** Upstream's confirm and sized dialogs (`bE` + `k_`): the nested scrim plus a 2px blur of the parent. */
export const DIALOG_NESTED_SCRIM_BLUR_CLASS = `${DIALOG_NESTED_SCRIM_CLASS} data-[nested-dialog-open]:blur-[2px]`;
