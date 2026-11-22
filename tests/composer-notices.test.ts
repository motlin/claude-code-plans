import {describe, expect, it} from "vite-plus/test";
import {NOTICE_ORDER, orderNotices} from "../src/lib/composer-notices";
import type {Notice, NoticeSlot} from "../src/lib/composer-notices";

describe("NOTICE_ORDER", () =>
{
	it("matches upstream's xJ order list (2026-11-21)", () =>
	{
		expect(NOTICE_ORDER).toStrictEqual([
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
		]);
	});
});

describe("orderNotices", () =>
{
	const limit: Notice =
	{
		id: "code_usage_limit",
	};
	const workflow: Notice =
	{
		id: "code_workflow_size_warning",
	};
	const sleep: Notice =
	{
		id: "sleep",
	};

	it("returns notices in NOTICE_ORDER regardless of registration order, keyed code-<slot>:<id>", () =>
	{
		const entries = new Map<NoticeSlot, Notice>();
		entries.set("limit", limit);
		entries.set("workflow", workflow);
		entries.set("sleep", sleep);

		expect(orderNotices(entries)).toStrictEqual([
			{
				key: "code-workflow:code_workflow_size_warning",
				slot: "workflow",
				notice: workflow,
			},
			{
				key: "code-limit:code_usage_limit",
				slot: "limit",
				notice: limit,
			},
			{
				key: "code-sleep:sleep",
				slot: "sleep",
				notice: sleep,
			},
		]);
	});

	it("drops an unregistered slot and keeps the rest in order", () =>
	{
		const entries = new Map<NoticeSlot, Notice>();
		entries.set("limit", limit);
		entries.set("workflow", workflow);
		entries.set("sleep", sleep);
		entries.delete("workflow");

		expect(orderNotices(entries)).toStrictEqual([
			{
				key: "code-limit:code_usage_limit",
				slot: "limit",
				notice: limit,
			},
			{
				key: "code-sleep:sleep",
				slot: "sleep",
				notice: sleep,
			},
		]);
	});

	it("orders eagerCookie before limit and refusal like upstream's Ym", () =>
	{
		const entries = new Map<NoticeSlot, Notice>();
		entries.set(
			"refusal",
			{
				id: "code_refusal_fallback",
			},
		);
		entries.set(
			"limit",
			{
				id: "code_usage_limit",
			},
		);
		entries.set(
			"eagerCookie",
			{
				id: "code_eager_cookie",
			},
		);

		expect(orderNotices(entries)).toStrictEqual([
			{
				key: "code-eagerCookie:code_eager_cookie",
				slot: "eagerCookie",
				notice:
				{
					id: "code_eager_cookie",
				},
			},
			{
				key: "code-limit:code_usage_limit",
				slot: "limit",
				notice:
				{
					id: "code_usage_limit",
				},
			},
			{
				key: "code-refusal:code_refusal_fallback",
				slot: "refusal",
				notice:
				{
					id: "code_refusal_fallback",
				},
			},
		]);
	});

	it("orders accountNotice first and notLive after limit like upstream's xJ", () =>
	{
		const entries = new Map<NoticeSlot, Notice>();
		entries.set(
			"notLive",
			{
				id: "code_not_live",
			},
		);
		entries.set(
			"limit",
			{
				id: "code_usage_limit",
			},
		);
		entries.set(
			"accountNotice",
			{
				id: "code_account_notice",
			},
		);

		expect(orderNotices(entries)).toStrictEqual([
			{
				key: "code-accountNotice:code_account_notice",
				slot: "accountNotice",
				notice:
				{
					id: "code_account_notice",
				},
			},
			{
				key: "code-limit:code_usage_limit",
				slot: "limit",
				notice:
				{
					id: "code_usage_limit",
				},
			},
			{
				key: "code-notLive:code_not_live",
				slot: "notLive",
				notice:
				{
					id: "code_not_live",
				},
			},
		]);
	});

	it("returns an empty list when nothing is registered", () =>
	{
		expect(orderNotices(new Map())).toStrictEqual([]);
	});
});
