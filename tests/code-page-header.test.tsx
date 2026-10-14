// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {CodePageHeader} from "../src/components/code-page-header";

afterEach(cleanup);

describe("CodePageHeader", () => {
	it("sets upstream's compact 24/32 serif title over a tab row that carries the toolbar on its right", () => {
		render(
			<CodePageHeader
				title="Artifacts"
				tabs={<div role="tablist" aria-label="Views" />}
				toolbar={<button type="button">Search</button>}
			/>,
		);
		const title = screen.getByRole("heading", {level: 1, name: "Artifacts"});
		const tabs = screen.getByRole("tablist", {name: "Views"});
		const toolbar = screen.getByRole("button", {name: "Search"});
		expect({
			title: title.className
				.split(" ")
				.filter((name) => ["font-voice", "text-[24px]/[32px]", "font-medium"].includes(name)),
			sameRow: tabs.parentElement === toolbar.parentElement?.parentElement,
			toolbarRight: toolbar.parentElement?.className.split(" ").includes("ms-auto"),
		}).toStrictEqual({
			title: ["font-voice", "text-[24px]/[32px]", "font-medium"],
			sameRow: true,
			toolbarRight: true,
		});
	});
});
