/**
 * Upstream's composer notice region renders every registered notice, stacked
 * in this fixed slot order (`xJ` in claude.ai/code cc43287c9, crawl 2026-11-21;
 * `eagerCookie` = cold-resume notice and `tokenLimit` = 3P token-cap band;
 * `eagerCookie`, `tokenLimit`, `accountNotice`, `keenSwing`, `softTide` and
 * `notLive` have no local registrant yet).
 */
export const NOTICE_ORDER = [
	"ops",
	"accountNotice",
	"paused",
	"environment",
	"acorn",
	"credits",
	"workflow",
	"eagerCookie",
	"limit",
	"tokenLimit",
	"refusal",
	"sleep",
	"keptAwake",
	"keenSwing",
	"softTide",
	"bridge",
	"notLive",
	"hostSandbox",
	"repository",
	"credentialNudge",
] as const;

export type NoticeSlot = (typeof NOTICE_ORDER)[number];

export interface Notice
{
	readonly id: string;
}

export interface OrderedNotice<N extends Notice = Notice>
{
	/** Upstream keys region items `code-<slot>:<id>`. */
	readonly key: string;
	readonly slot: NoticeSlot;
	readonly notice: N;
}

export function orderNotices<N extends Notice>(entries: ReadonlyMap<NoticeSlot, N>): OrderedNotice<N>[]
{
	return NOTICE_ORDER.flatMap((slot) =>
	{
		const notice = entries.get(slot);
		return notice === undefined
			? []
			: [
					{
						key: `code-${slot}:${notice.id}`,
						slot,
						notice,
					},
				];
	});
}
