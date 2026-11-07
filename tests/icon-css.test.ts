import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

function block(selector: string): string {
	const start = styles.indexOf(`\n${selector} {`);
	if (start === -1) return "";
	return styles.slice(start, styles.indexOf("}", start));
}

function token(source: string, name: string): string | null {
	return source.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1] ?? null;
}

describe("cds Icon CSS (c6a992d55)", () => {
	it("carries the density's icon box in --cds-icon: 1rem compact, 1.25rem comfortable and at the root", () => {
		expect({
			root: token(block(":root"), "--cds-icon"),
			comfortable: token(block('[data-density="comfortable"]'), "--cds-icon"),
			compact: token(block('[data-density="compact"]'), "--cds-icon"),
		}).toStrictEqual({
			root: "calc(1.25rem * var(--cds-rem-scale, 1))",
			comfortable: "calc(1.25rem * var(--cds-rem-scale, 1))",
			compact: "calc(1rem * var(--cds-rem-scale, 1))",
		});
	});

	it("copies upstream's Icon rules, size-icon/w-icon utilities and the cds-Icon variant", () => {
		const rules = [
			'[data-cds="Icon"] {\n\tflex-shrink: 0;\n}',
			':root[dir="rtl"] :is([data-cds="Icon"], svg)[data-cds-mirror]:dir(rtl) {\n\ttransform: scaleX(-1);\n}',
			'[data-cds="Icon"][data-cds-rotate] {\n\t--cds-icon-rotate: 0deg;\n\trotate: var(--cds-icon-rotate);\n}',
			':root[dir="rtl"] [data-cds="Icon"][data-cds-rotate]:dir(rtl) {\n\trotate: calc(var(--cds-icon-rotate) * -1);\n}',
			"@utility size-icon {\n\twidth: var(--cds-icon);\n\theight: var(--cds-icon);\n}",
			"@utility w-icon {\n\twidth: var(--cds-icon);\n}",
			"@custom-variant cds-Icon (& [data-cds=Icon]);",
		];
		expect(rules.filter((rule) => !styles.includes(rule))).toStrictEqual([]);
	});
});
