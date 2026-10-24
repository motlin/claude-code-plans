// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {ChromeDevtoolsRenderer} from "../src/components/tool-renderers/chrome-devtools-renderer";
import {PlaywrightRenderer} from "../src/components/tool-renderers/playwright-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

afterEach(cleanup);

function toolCall(name: string, result: string): ClientToolCall {
	return {
		id: "tool-call-1",
		name,
		input: {},
		param: "",
		result,
		sourceUuid: "source-1",
		outputImages: [{mimeType: "image/png", data: "AAA"}],
	};
}

function imageSources(container: HTMLElement): (string | null)[] {
	return [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
}

// Browsers block file:// images on an http page; the step body draws the result's own image instead.
describe("screenshot renderers", () => {
	it("Playwright's take-screenshot draws no file:// image", () => {
		const {container} = render(
			<PlaywrightRenderer
				toolCall={toolCall(
					"mcp__plugin_playwright_playwright__browser_take_screenshot",
					"Saved screenshot to /tmp/shot.png",
				)}
			/>,
		);

		expect(imageSources(container)).toStrictEqual([]);
	});

	it("DevTools' take_screenshot draws no file:// image", () => {
		const {container} = render(
			<ChromeDevtoolsRenderer
				toolCall={toolCall(
					"mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot",
					"Saved screenshot to /tmp/shot.png",
				)}
			/>,
		);

		expect(imageSources(container)).toStrictEqual([]);
	});

	it("DevTools' screenshot_path result draws no file:// image", () => {
		const {container} = render(
			<ChromeDevtoolsRenderer
				toolCall={toolCall(
					"mcp__plugin_chrome-devtools-mcp_chrome-devtools__click",
					JSON.stringify({screenshot_path: "/tmp/shot.png"}),
				)}
			/>,
		);

		expect(imageSources(container)).toStrictEqual([]);
	});
});
