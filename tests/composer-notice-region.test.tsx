// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {
	ComposerNoticeProvider,
	ComposerNoticeRegion,
	NOTICE_ENTER_CLASS,
	useComposerNotice,
} from "../src/components/composer-notice-region";
import type {NoticeSlot} from "../src/lib/composer-notices";

afterEach(cleanup);

function Band({slot, id, text}: {slot: NoticeSlot; id: string; text: string}) {
	const claimed = useComposerNotice(slot, {id, content: <span>{text}</span>});
	return claimed ? null : <span data-inline-band>{text}</span>;
}

function itemsOf(container: HTMLElement) {
	const status = container.querySelectorAll('[role="status"][aria-live="polite"]');
	expect(status).toHaveLength(1);
	return [...status[0]!.children].map((item) => ({text: item.textContent, className: item.className}));
}

describe("ComposerNoticeRegion", () => {
	it("stacks registered notices in NOTICE_ORDER inside one polite status list", () => {
		const {container} = render(
			<ComposerNoticeProvider>
				<ComposerNoticeRegion />
				<Band slot="sleep" id="sleep" text="Sleeping" />
				<Band slot="limit" id="code_usage_limit" text="Limit" />
				<Band slot="workflow" id="code_workflow_size_warning" text="Workflow" />
			</ComposerNoticeProvider>,
		);

		const region = container.querySelector("[data-code-column-notices]");
		expect(region?.className).toBe("-mb-1.5");
		const list = region?.firstElementChild;
		expect(list?.getAttribute("data-cds")).toBe("ChatComposerNotices");
		expect(list?.getAttribute("tabindex")).toBe("-1");
		expect(list?.className).toBe("w-full");
		expect(list?.firstElementChild?.getAttribute("aria-atomic")).toBe("false");
		expect(itemsOf(container)).toStrictEqual([
			{text: "Workflow", className: `pb-1 ${NOTICE_ENTER_CLASS}`},
			{text: "Limit", className: `pb-1 ${NOTICE_ENTER_CLASS}`},
			{text: "Sleeping", className: `pb-1 ${NOTICE_ENTER_CLASS}`},
		]);
		expect(container.querySelectorAll("[data-inline-band]")).toHaveLength(0);
	});

	it("skips the enter animation for a notice registered before the region mounted", () => {
		const {container} = render(
			<ComposerNoticeProvider>
				<Band slot="limit" id="code_usage_limit" text="Limit" />
				<ComposerNoticeRegion />
			</ComposerNoticeProvider>,
		);

		expect(itemsOf(container)).toStrictEqual([{text: "Limit", className: "pb-1"}]);
	});

	it("drops a notice when its band unregisters", () => {
		const {container, rerender} = render(
			<ComposerNoticeProvider>
				<ComposerNoticeRegion />
				<Band slot="limit" id="code_usage_limit" text="Limit" />
				<Band slot="sleep" id="sleep" text="Sleeping" />
			</ComposerNoticeProvider>,
		);
		rerender(
			<ComposerNoticeProvider>
				<ComposerNoticeRegion />
				<Band slot="sleep" id="sleep" text="Sleeping" />
			</ComposerNoticeProvider>,
		);

		expect(itemsOf(container)).toStrictEqual([{text: "Sleeping", className: `pb-1 ${NOTICE_ENTER_CLASS}`}]);
	});

	it("leaves a band inline when no region provider is mounted", () => {
		const {container} = render(<Band slot="limit" id="code_usage_limit" text="Limit" />);

		expect(container.innerHTML).toBe('<span data-inline-band="true">Limit</span>');
	});
});
