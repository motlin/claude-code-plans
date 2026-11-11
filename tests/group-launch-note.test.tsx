// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {GroupLaunchNote} from "../src/components/home/group-launch-note";

afterEach(() => {
	cleanup();
});

/** Each element as `tag.class` with its own text or children, so the tree compares in one assertion. */
function tree(element: Element): unknown {
	const children = Array.from(element.children);
	return {
		tag: element.tagName.toLowerCase(),
		class: element.getAttribute("class"),
		...(children.length === 0 ? {text: element.textContent} : {children: children.map(tree)}),
	};
}

describe("GroupLaunchNote", () => {
	it("renders upstream's line note: the group name between the two string parts, then Don’t add", () => {
		const {container} = render(<GroupLaunchNote name="Infra" placement="line" onDismiss={() => {}} />);
		const button = screen.getByRole("button", {name: "Don’t add to Infra"});

		expect({
			tree: tree(container.firstElementChild!),
			button: {
				type: button.getAttribute("type"),
				cds: button.getAttribute("data-cds"),
			},
		}).toStrictEqual({
			tree: {
				tag: "span",
				class: "pointer-events-auto flex min-w-0 items-baseline gap-1 whitespace-nowrap",
				children: [
					{
						tag: "span",
						class: "flex min-w-0 items-baseline overflow-hidden",
						children: [
							{tag: "span", class: "shrink-0 whitespace-pre", text: "This session will be added to "},
							{
								tag: "span",
								class: "flex min-w-0 font-medium text-primary",
								children: [{tag: "span", class: "min-w-0 truncate", text: "Infra"}],
							},
							{tag: "span", class: "shrink-0 whitespace-pre", text: " in the sidebar when you start it."},
						],
					},
					{tag: "button", class: "cds-reset text-link-inherit shrink-0 whitespace-nowrap", text: "Don’t add"},
				],
			},
			button: {type: "button", cds: "TextLink"},
		});
	});

	it("renders the block variant as a centered footnote paragraph", () => {
		const {container} = render(<GroupLaunchNote name="Infra" placement="block" onDismiss={() => {}} />);

		expect(tree(container.firstElementChild!)).toStrictEqual({
			tag: "p",
			class: "text-center text-balance text-footnote text-secondary",
			children: [
				{tag: "span", class: "font-medium text-primary", text: "Infra"},
				{tag: "button", class: "cds-reset text-link-inherit", text: "Don’t add"},
			],
		});
		expect(container.textContent).toBe(
			"This session will be added to Infra in the sidebar when you start it. Don’t add",
		);
	});

	it("calls onDismiss from Don’t add, a Tab-reachable button", () => {
		const onDismiss = vi.fn<() => void>();
		render(<GroupLaunchNote name="Infra" placement="line" onDismiss={onDismiss} />);
		const button = screen.getByRole("button", {name: "Don’t add to Infra"});
		fireEvent.click(button);

		expect({calls: onDismiss.mock.calls.length, tabIndex: button.tabIndex}).toStrictEqual({calls: 1, tabIndex: 0});
	});
});
