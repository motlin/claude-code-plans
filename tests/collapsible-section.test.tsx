// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {CollapsibleSection} from "../src/components/tool-renderers/shared";

afterEach(() => {
	cleanup();
});

describe("CollapsibleSection", () => {
	it("draws upstream's generic cds fold: footnote trigger in text-secondary, filled caret first, children on open", () => {
		const {container} = render(
			<CollapsibleSection label="Details">
				<p>Body text</p>
			</CollapsibleSection>,
		);
		const button = screen.getByRole("button", {name: "Details"});
		const tokens = button.className.split(" ");
		const closed = {
			cds: container.firstElementChild?.getAttribute("data-cds"),
			expanded: button.getAttribute("aria-expanded"),
			clp: tokens.includes("group/clp"),
			footnote: tokens.includes("text-footnote"),
			secondary: tokens.includes("text-secondary"),
			legacy: tokens.filter((token) => ["text-xs", "text-t6", "text-body"].includes(token)),
			caret: button.firstElementChild?.getAttribute("data-cds"),
			body: screen.queryByText("Body text"),
		};

		fireEvent.click(button);
		const body = screen.getByText("Body text");

		expect({
			closed,
			openExpanded: button.getAttribute("aria-expanded"),
			wrappers: [body.parentElement?.className, body.parentElement?.parentElement?.className],
		}).toStrictEqual({
			closed: {
				cds: "Collapsible",
				expanded: "false",
				clp: true,
				footnote: true,
				secondary: true,
				legacy: [],
				caret: "Icon",
				body: null,
			},
			openExpanded: "true",
			wrappers: ["mt-1", "flow-root"],
		});
	});

	it("starts open with defaultOpen", () => {
		render(
			<CollapsibleSection label="Details" defaultOpen>
				<p>Body text</p>
			</CollapsibleSection>,
		);
		expect(screen.getByRole("button", {name: "Details"}).getAttribute("aria-expanded")).toBe("true");
	});
});
