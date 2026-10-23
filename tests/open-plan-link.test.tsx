// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {OpenPlanLink} from "../src/components/open-plan-link";

afterEach(cleanup);

describe("OpenPlanLink", () => {
	it("is upstream's footnote TextLink span with role=button, opened by click, Enter and Space", () => {
		const onOpen = vi.fn<() => void>();
		render(<OpenPlanLink onOpen={onOpen} />);
		const link = screen.getByRole("button", {name: "Open plan"});

		fireEvent.click(link);
		fireEvent.keyDown(link, {key: "Enter"});
		fireEvent.keyDown(link, {key: " "});
		fireEvent.keyDown(link, {key: "a"});

		expect({
			outer: link.outerHTML,
			calls: onOpen.mock.calls.length,
		}).toStrictEqual({
			outer: '<span role="button" tabindex="0" data-cds="TextLink" class="text-link inline cursor-pointer text-footnote">Open plan</span>',
			calls: 3,
		});
	});
});
