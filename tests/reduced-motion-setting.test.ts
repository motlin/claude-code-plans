import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

function rulesFor(selectorPrefix: string): string[] {
	return [
		...styles.matchAll(
			/^((?:html\[data-motion="reduced"\][^\n{]*,\n)*html\[data-motion="reduced"\][^\n{]*) \{\n([^}]*)\}/gm,
		),
	]
		.filter((match) => match[1]?.includes(selectorPrefix) === true)
		.map((match) => `${match[1]} {\n${match[2]}}`);
}

describe("Settings ▸ Motion ▸ Reduced", () => {
	it("stops every looping animation, including the cds Spinner ring", () => {
		expect(rulesFor(".animate-pulse")).toStrictEqual([
			'html[data-motion="reduced"] .animate-pulse,\n' +
				'html[data-motion="reduced"] .animate-ping,\n' +
				'html[data-motion="reduced"] .animate-approval-inline-enter,\n' +
				'html[data-motion="reduced"] .animate-question-receipt-enter,\n' +
				'html[data-motion="reduced"] .status-dot[data-kind="running"],\n' +
				'html[data-motion="reduced"] .terminal-caret,\n' +
				'html[data-motion="reduced"] [data-spinner] * {\n' +
				"\tanimation: none !important;\n}",
		]);
	});

	it("hides the ShimmerText clone, as the OS reduced-motion query does", () => {
		expect(rulesFor("[data-cds-shimmer-clone]")).toStrictEqual([
			'html[data-motion="reduced"] [data-cds-shimmer-clone] {\n\tdisplay: none;\n}',
		]);
	});

	it("hides the Skeleton sheen, as motion-reduce:after:hidden does", () => {
		expect(rulesFor('[data-cds="Skeleton"]')).toStrictEqual([
			'html[data-motion="reduced"] [data-cds="Skeleton"]::after {\n\tdisplay: none;\n}',
		]);
	});
});
