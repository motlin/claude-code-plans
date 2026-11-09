// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {HookNoticeRow} from "../src/components/hook-notice-row";
import type {HookNotice} from "../src/lib/transcript";

afterEach(cleanup);

const NOTICE: HookNotice = {message: "Compacted while idle", level: "notice", uuid: "n-1"};
const WARNING: HookNotice = {message: "Remote Control disconnected", level: "warning", uuid: "w-1"};

function snapshot(container: HTMLElement) {
	const root = container.querySelector("[data-hook-notice]");
	const button = root?.querySelector("button");
	const body = root?.querySelector(".epitaxy-expanding-body");
	return {
		label: button?.querySelector("span.truncate")?.textContent,
		expanded: button?.getAttribute("aria-expanded"),
		headerIcons: button?.querySelectorAll('[aria-label="Warning"]').length,
		body:
			body === null || body === undefined
				? null
				: {
						hidden: body.hasAttribute("hidden"),
						className: body.className,
						lines: Array.from(body.querySelectorAll(".select-text"), (line) => ({
							icon: line.querySelector('[aria-label="Warning"]') !== null,
							text: line.textContent,
						})),
					},
	};
}

describe("HookNoticeRow", () => {
	it("starts a lone notice collapsed with no body and no icon", () => {
		const {container} = render(<HookNoticeRow notices={[NOTICE]} verbose={false} />);
		expect(snapshot(container)).toStrictEqual({
			label: "Claude Code notice",
			expanded: "false",
			headerIcons: 0,
			body: null,
		});
	});

	it("mounts the body on the first click and keeps it hidden after collapsing", () => {
		const {container} = render(<HookNoticeRow notices={[NOTICE]} verbose={false} />);
		const button = container.querySelector("button");
		if (button === null) throw new Error("no button");
		fireEvent.click(button);
		const opened = snapshot(container);
		fireEvent.click(button);
		expect([opened, snapshot(container)]).toStrictEqual([
			{
				label: "Claude Code notice",
				expanded: "true",
				headerIcons: 0,
				body: {
					hidden: false,
					className: "epitaxy-expanding-body flow-root",
					lines: [{icon: false, text: "Compacted while idle"}],
				},
			},
			{
				label: "Claude Code notice",
				expanded: "false",
				headerIcons: 0,
				body: {
					hidden: true,
					className: "epitaxy-expanding-body",
					lines: [{icon: false, text: "Compacted while idle"}],
				},
			},
		]);
	});

	it("opens a lone warning by default with the header icon and no line icon", () => {
		const {container} = render(<HookNoticeRow notices={[WARNING]} verbose={false} />);
		expect(snapshot(container)).toStrictEqual({
			label: "Claude Code notice",
			expanded: "true",
			headerIcons: 1,
			body: {
				hidden: false,
				className: "epitaxy-expanding-body flow-root",
				lines: [{icon: false, text: "Remote Control disconnected"}],
			},
		});
	});

	it("counts merged notices and marks each warning line", () => {
		const {container} = render(<HookNoticeRow notices={[NOTICE, WARNING]} verbose={false} />);
		expect(snapshot(container)).toStrictEqual({
			label: "2 Claude Code notices",
			expanded: "true",
			headerIcons: 1,
			body: {
				hidden: false,
				className: "epitaxy-expanding-body flow-root",
				lines: [
					{icon: false, text: "Compacted while idle"},
					{icon: true, text: "Remote Control disconnected"},
				],
			},
		});
	});

	it("drops the toggle and re-defaults to open when a warning merges in", () => {
		const {container, rerender} = render(<HookNoticeRow notices={[NOTICE]} verbose={false} />);
		const button = container.querySelector("button");
		if (button === null) throw new Error("no button");
		fireEvent.click(button);
		fireEvent.click(button);
		rerender(<HookNoticeRow notices={[NOTICE, WARNING]} verbose={false} />);
		expect(snapshot(container).expanded).toBe("true");
	});

	it("forces verbose open and ignores clicks", () => {
		const {container} = render(<HookNoticeRow notices={[NOTICE]} verbose />);
		const button = container.querySelector("button");
		if (button === null) throw new Error("no button");
		fireEvent.click(button);
		expect(snapshot(container).expanded).toBe("true");
	});

	it("copies upstream's class strings", () => {
		const {container} = render(<HookNoticeRow notices={[NOTICE, WARNING]} verbose={false} />);
		const root = container.querySelector("[data-hook-notice]");
		const button = root?.querySelector("button");
		const labelSpan = button?.querySelector("span.truncate");
		const caretSpan = labelSpan?.nextElementSibling;
		const inner = root?.querySelector(".epitaxy-expanding-body > div");
		const line = inner?.querySelector(".select-text");
		const iconSlot = inner?.querySelectorAll(".select-text")[1]?.firstElementChild;
		expect({
			root: root?.className,
			button: button?.className,
			buttonType: button?.getAttribute("type"),
			label: labelSpan?.className,
			caret: caretSpan?.className,
			inner: inner?.className,
			line: line?.className,
			iconSlot: iconSlot?.className,
			message: line?.lastElementChild?.className,
		}).toStrictEqual({
			root: "flex w-full flex-col ps-[var(--cds-assistant-message-text-inset,0px)]",
			button: "relative group/tool flex self-start max-w-full items-center py-0 gap-1 text-start focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus rounded-sm",
			buttonType: "button",
			label: "min-w-0 truncate text-body text-secondary group-hover/tool:text-primary",
			caret: "shrink-0 text-secondary group-hover/tool:text-primary",
			inner: "flex flex-col gap-1 ps-p6 comfortable:ps-p8 pt-p3 comfortable:pt-p5",
			line: "flex items-start gap-1 select-text",
			iconSlot: "text-body flex h-[1lh] shrink-0 items-center",
			message: "min-w-0 text-body text-secondary whitespace-pre-wrap [overflow-wrap:anywhere]",
		});
	});

	it("keeps line breaks in a multi-line message", () => {
		const {container} = render(
			<HookNoticeRow notices={[{message: "Version 2.1.227:\n· Fixed a", level: "warning"}]} verbose={false} />,
		);
		expect(container.querySelector(".select-text")?.textContent).toBe("Version 2.1.227:\n· Fixed a");
	});
});
