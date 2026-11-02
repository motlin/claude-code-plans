import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

function block(selector: string): string {
	const start = styles.indexOf(`\n${selector} {`);
	if (start === -1) return "";
	return styles.slice(start, styles.indexOf("\n}", start));
}

function token(source: string, name: string): string | null {
	return source.match(new RegExp(`\\s${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
}

describe("fizzy-lake type tokens (upstream data-cds-fizzy-lake~=type)", () => {
	it("--font-weight-control is the pre-rollout 500, and upstream's --cds-font-weight-control 435 under fizzy-lake type", () => {
		expect({
			theme: token(block("@theme"), "--font-weight-control"),
			type: token(block(':root[data-cds-fizzy-lake~="type"]'), "--font-weight-control"),
		}).toStrictEqual({theme: "500", type: "435"});
	});
});
