/** claude.ai/code's session hover card: Needs input rows open sooner and wider, with reply controls. */
export const SESSION_HOVER_CARD = {
	blocked: {delay: 400, width: "[--preview-card-min-w:440px] [--preview-card-max-w:440px] !px-0 !py-0"},
	other: {delay: 500, width: "[--preview-card-min-w:340px] [--preview-card-max-w:340px]"},
} as const;

export const CLOSE_DELAY_MS = 200;

/** Upstream's PreviewCard collision padding, clear of the 48px titlebar row. */
export const COLLISION_PADDING = {top: 48, right: 8, bottom: 8, left: 8};

/** Upstream's PreviewCard shell; the ring and drop shadows are its light `shadow-panel`. */
export const POPUP_CLASS =
	"flex flex-col gap-1 min-w-[var(--preview-card-min-w,200px)] max-w-[min(var(--preview-card-max-w,360px),calc(100vw-16px))] rounded-card bg-surface-3 p-3 text-[13px]/[19px] font-normal text-primary break-words outline-none shadow-[0_0_0_1px_var(--color-border),0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08)] select-text";

export type HoverCardKind = keyof typeof SESSION_HOVER_CARD;

/** Upstream's sr-only hint that a Needs input row's card answers in place. */
export const QUICK_REPLY_HINT =
	"Quick reply and approval controls available — press Tab until focus enters the card, Escape to return.";
