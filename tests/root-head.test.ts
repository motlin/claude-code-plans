// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {Route} from "../src/routes/__root";

describe("root route head", () => {
	it("extends the layout viewport under phone safe areas and resizes it for the on-screen keyboard", () => {
		const head = Route.options.head as () => {meta: Array<Record<string, string>>};
		expect(head().meta.filter((meta) => meta["name"] === "viewport")).toStrictEqual([
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
			},
		]);
	});

	it("uses the purple ten-ray spark favicon on a transparent background", () => {
		const head = Route.options.head as () => {links: Array<Record<string, string>>};
		const icon = head().links.find((link) => link["rel"] === "icon");
		const svg = decodeURIComponent(icon?.["href"]?.replace("data:image/svg+xml,", "") ?? "");
		expect(svg.match(/<rect /g)).toHaveLength(10);
		expect(svg).toContain("fill='#8B5CF6'");
		expect(svg).not.toContain("width='32' height='32'");
	});

	it("marks the document comfortable, upstream's web shell density", () => {
		const source = readFileSync("src/routes/__root.tsx", "utf8");
		expect(source.match(/<html [^>]*>/g)).toStrictEqual([
			'<html lang="en" data-density="comfortable" suppressHydrationWarning>',
		]);
	});
});
