import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

import {HOME_COLUMN} from "../src/components/home/home-column";

describe("HOME_COLUMN", () => {
	it("narrows to upstream's 16px/24px gutters by tile width (tile-slot ≤560px), not by viewport, so the composer is 313+462 at 800px", () => {
		expect(HOME_COLUMN).toBe(
			"mx-auto w-full max-w-[840px] pr-10 pl-8 [@container_tile-slot_(max-width:560px)]:pr-6 [@container_tile-slot_(max-width:560px)]:pl-4",
		);
	});

	it("insets the phone home tile 9px at the start and 1px at the end like the session card, so the composer is 41+518 at 600px and 25+510 at 560px", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const phone =
			styles.match(/@media \(width < 40rem\) \{[^@]*?\[data-route-tile-shell="home"\] \{([^}]+)\}/)?.[1] ?? "";
		expect(
			phone
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line !== "" && !line.startsWith("/*")),
		).toStrictEqual([
			"padding-inline: 9px 1px;",
			"--tile-title-start: max(0px, calc(var(--top-left-clearance-start, 0px) - 9px));",
		]);
	});
});
