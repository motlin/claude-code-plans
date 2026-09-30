// @vitest-environment jsdom

import {render} from "@testing-library/react";
import {describe, expect, it} from "vite-plus/test";
import {StatusDot} from "../src/components/sidebar/primitives/StatusDot";

function statusDotClasses(active: boolean) {
	const view = render(<StatusDot active={active} />);
	return [...view.container.querySelectorAll("span")].map(({className}) => className);
}

describe("StatusDot", () => {
	it("pulses green for an active pane or window", () => {
		expect(statusDotClasses(true)).toStrictEqual([
			"relative flex h-2.5 w-2.5 shrink-0",
			"absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75",
			"relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500",
		]);
	});

	it("shows a small muted dot when inactive", () => {
		expect(statusDotClasses(false)).toStrictEqual([
			"flex h-2.5 w-2.5 shrink-0 items-center justify-center",
			"h-2 w-2 rounded-full bg-t6/40",
		]);
	});
});
