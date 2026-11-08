// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {FileColumnResizeShield} from "../src/components/ui/file-column-resize-shield";

function shield(): HTMLElement | null {
	return document.querySelector<HTMLElement>("[data-file-tree-resize-shield]");
}

describe("FileColumnResizeShield", () => {
	afterEach(cleanup);

	it("renders nothing while inactive", () => {
		render(<FileColumnResizeShield active={false} />);
		expect(shield()).toBeNull();
	});

	it("portals upstream's veil into document.body while active", () => {
		render(
			<div data-host>
				<FileColumnResizeShield active />
			</div>,
		);
		const element = shield();
		expect({
			parent: element?.parentElement === document.body,
			classes: [...(element?.classList ?? [])].toSorted(),
			hidden: element?.getAttribute("aria-hidden"),
			attribute: element?.getAttribute("data-file-tree-resize-shield"),
			zIndex: element?.style.zIndex,
		}).toStrictEqual({
			parent: true,
			classes: ["bg-alpha-1", "cursor-col-resize", "fixed", "inset-0", "opacity-20"],
			hidden: "true",
			attribute: "",
			zIndex: "50",
		});
	});
});
