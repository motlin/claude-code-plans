/**
 * Upstream's composer notice region renders every registered notice, stacked
 * in this fixed slot order (`un` in claude.ai/code, live crawl 2026-10-20).
 */
export const NOTICE_ORDER = [
	"ops",
	"paused",
	"environment",
	"acorn",
	"credits",
	"effort",
	"workflow",
	"limit",
	"refusal",
	"sleep",
	"keptAwake",
	"bridge",
	"hostSandbox",
	"repository",
	"credentialNudge",
] as const;

export type NoticeSlot = (typeof NOTICE_ORDER)[number];

export interface Notice {
	readonly id: string;
}

export interface OrderedNotice<N extends Notice = Notice> {
	/** Upstream keys region items `code-<slot>:<id>`. */
	readonly key: string;
	readonly slot: NoticeSlot;
	readonly notice: N;
}

export function orderNotices<N extends Notice>(entries: ReadonlyMap<NoticeSlot, N>): OrderedNotice<N>[] {
	return NOTICE_ORDER.flatMap((slot) => {
		const notice = entries.get(slot);
		return notice === undefined ? [] : [{key: `code-${slot}:${notice.id}`, slot, notice}];
	});
}
