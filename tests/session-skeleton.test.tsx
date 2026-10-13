// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {SessionSkeleton} from "../src/components/session-skeleton";

afterEach(cleanup);

describe("SessionSkeleton", () => {
	it("draws upstream's pending session where the session will paint: the header dot and bar in the header slot, then a user bubble and three paragraph groups in the gutter-inset chat column, with no cards", () => {
		const {container} = render(<SessionSkeleton />);
		const column = container.querySelector(".chat-column")!;

		expect({
			bordered: container.querySelectorAll("[class*='border']").length,
			headerRow: container.querySelector("[data-skeleton-header]")!.className,
			header: Array.from(container.querySelector("[data-skeleton-header]")!.children, (bar) => bar.className),
			scroller: column.parentElement!.className,
			columnClassName: column.className,
			bubble: Array.from(column.querySelectorAll("[data-skeleton-bubble]"), (bubble) => bubble.className),
			groups: Array.from(column.querySelectorAll("[data-skeleton-paragraph]"), (group) =>
				Array.from(group.children, (bar) => bar.className.split(" ").find((name) => name.startsWith("w-"))),
			),
		}).toStrictEqual({
			bordered: 0,
			headerRow: "flex items-center gap-[7px] px-[7px] pt-[6px]",
			header: [
				"size-[18px] shrink-0 rounded-full animate-pulse bg-fill-ghost-hover",
				"h-[18px] w-[190px] animate-pulse rounded bg-fill-ghost-hover",
			],
			scroller: "overflow-y-auto [scrollbar-gutter:stable_both-edges]",
			columnClassName: "chat-column mt-[56px] flex flex-col",
			bubble: ["h-8 w-[288px] max-w-full self-end rounded-r7 animate-pulse bg-fill-ghost-hover"],
			groups: [
				["w-[95%]", "w-[99%]", "w-[91%]", "w-[57%]"],
				["w-[99%]", "w-[93%]", "w-[41%]"],
				["w-[96%]", "w-[89%]", "w-[65%]"],
			],
		});
	});
});
