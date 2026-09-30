// @vitest-environment jsdom

import {render, screen} from "@testing-library/react";
import {createElement} from "react";
import {describe, expect, it} from "vite-plus/test";
import {greetingText, HomeGreeting} from "../src/components/home/greeting";

describe("greetingText", () => {
	it.each([
		{name: "Craig", clear: false, expected: "Welcome back, Craig"},
		{name: "Craig", clear: true, expected: "What’s up next, Craig?"},
		{name: undefined, clear: false, expected: "Welcome back"},
		{name: undefined, clear: true, expected: "What’s up next?"},
		{name: "  ", clear: false, expected: "Welcome back"},
	])("name=$name clear=$clear -> $expected", ({name, clear, expected}) => {
		expect(greetingText({name, clear})).toBe(expected);
	});
});

describe("HomeGreeting", () => {
	it("renders the greeting h1 beside an aria-hidden 22px spark", () => {
		const view = render(createElement(HomeGreeting, {name: "Craig", clear: false}));
		try {
			const heading = screen.getByRole("heading", {level: 1});
			const spark = view.container.querySelector("svg[data-cds='Spark']");
			expect({
				text: heading.textContent,
				headingClass: heading.className,
				sparkHidden: spark?.getAttribute("aria-hidden"),
				sparkSize: [spark?.getAttribute("width"), spark?.getAttribute("height")],
				sparkBeforeHeading: spark?.nextElementSibling === heading,
			}).toStrictEqual({
				text: "Welcome back, Craig",
				headingClass: "text-[20px] leading-[25px] font-normal text-primary",
				sparkHidden: "true",
				sparkSize: ["22", "22"],
				sparkBeforeHeading: true,
			});
		} finally {
			view.unmount();
		}
	});
});
