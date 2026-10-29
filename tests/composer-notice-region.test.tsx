// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {useState} from "react";
import {
	ComposerNoticeProvider,
	ComposerNoticeRegion,
	NOTICE_ENTER_CLASS,
	NOTICE_EXIT_CLASS,
	useComposerNotice,
} from "../src/components/composer-notice-region";
import type {NoticeSlot} from "../src/lib/composer-notices";
import {UsagePaceBand} from "../src/components/usage-pace-banner";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

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

	it("marks a notice leaving, in its slot position, when its band unregisters", () => {
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

		expect(itemsOf(container)).toStrictEqual([
			{text: "Limit", className: `pb-1 ${NOTICE_EXIT_CLASS} pointer-events-none`},
			{text: "Sleeping", className: `pb-1 ${NOTICE_ENTER_CLASS}`},
		]);
	});

	it("holds a leaving notice inert for up to 300ms and hands focus to the list root", () => {
		vi.useFakeTimers();
		function Dismissible() {
			const [shown, setShown] = useState(true);
			useComposerNotice(
				"limit",
				shown
					? {
							id: "code_usage_limit",
							content: (
								<button
									type="button"
									onClick={() => {
										setShown(false);
									}}
								>
									Dismiss
								</button>
							),
						}
					: null,
			);
			return null;
		}
		const {container, getByRole} = render(
			<ComposerNoticeProvider>
				<ComposerNoticeRegion />
				<Dismissible />
			</ComposerNoticeProvider>,
		);
		const dismiss = getByRole("button", {name: "Dismiss"});
		dismiss.focus();
		fireEvent.click(dismiss);

		const list = container.querySelector('[data-cds="ChatComposerNotices"]');
		const leaving = container.querySelector("[inert]");
		expect(leaving?.outerHTML).toBe(
			`<div class="pb-1 ${NOTICE_EXIT_CLASS} pointer-events-none" aria-hidden="true" inert=""><button type="button">Dismiss</button></div>`,
		);
		expect(document.activeElement).toBe(list);

		act(() => {
			vi.advanceTimersByTime(299);
		});
		expect(container.querySelector("[inert]")).toBe(leaving);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(container.querySelector("[inert]")).toBeNull();
		expect(document.activeElement).toBe(list);
	});

	it("drops a leaving notice as soon as its exit animation ends", () => {
		const {container, rerender} = render(
			<ComposerNoticeProvider>
				<ComposerNoticeRegion />
				<Band slot="limit" id="code_usage_limit" text="Limit" />
			</ComposerNoticeProvider>,
		);
		rerender(
			<ComposerNoticeProvider>
				<ComposerNoticeRegion />
			</ComposerNoticeProvider>,
		);
		const leaving = container.querySelector("[inert]");
		expect(leaving?.textContent).toBe("Limit");

		// jsdom has no AnimationEvent, so React listens for the prefixed name instead of `animationend`.
		fireEvent(leaving!, new Event("webkitAnimationEnd", {bubbles: true}));

		expect(itemsOf(container)).toStrictEqual([]);
	});

	it("leaves a band inline when no region provider is mounted", () => {
		const {container} = render(<Band slot="limit" id="code_usage_limit" text="Limit" />);

		expect(container.innerHTML).toBe('<span data-inline-band="true">Limit</span>');
	});

	it("drops the usage band's own enter animation inside the region, whose item already reveals in", () => {
		function RegisteredBand() {
			const claimed = useComposerNotice("limit", {
				id: "code_usage_limit",
				content: <UsagePaceBand resetText="Resets at 5:00 PM" onDismiss={() => {}} />,
			});
			return claimed ? null : <UsagePaceBand resetText="Resets at 5:00 PM" onDismiss={() => {}} />;
		}
		const {container: inRegion} = render(
			<ComposerNoticeProvider>
				<ComposerNoticeRegion />
				<RegisteredBand />
			</ComposerNoticeProvider>,
		);
		const {container: inline} = render(<RegisteredBand />);

		const bandClass =
			"flex gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 items-start py-[calc((40px-1lh)/2)] text-body";
		expect({
			inRegion: inRegion.querySelector('[data-cds="ChatComposerNotices"] .bg-alpha-1')?.className,
			inline: inline.querySelector(".bg-alpha-1")?.className,
		}).toStrictEqual({inRegion: bandClass, inline: `${bandClass} usage-band-enter`});
	});
});
