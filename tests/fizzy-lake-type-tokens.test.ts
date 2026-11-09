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

	it("--font-weight-control-regular is the pre-rollout 400 for regular-weight controls, and 435 under fizzy-lake type", () => {
		expect({
			theme: token(block("@theme"), "--font-weight-control-regular"),
			type: token(block(':root[data-cds-fizzy-lake~="type"]'), "--font-weight-control-regular"),
		}).toStrictEqual({theme: "400", type: "435"});
	});

	it("gives the regular-weight cds Button and Combobox copies upstream's `font-normal font-control` weight", () => {
		const constant = (file: string, name: string) =>
			readFileSync(file, "utf8")
				.match(new RegExp(`const ${name} =\\s*"([^"]+)"`))?.[1]
				?.split(" ") ?? [];
		const weights = (classes: readonly string[]) =>
			classes.filter((name) => /^font-(normal|medium|control|control-regular)$/.test(name));
		expect({
			selectionBar: weights(
				constant("src/components/transcript-selection-bar.tsx", "SELECTION_BAR_BUTTON_CLASS"),
			),
			turnChanges: weights(constant("src/components/turn-changes-card.tsx", "UNDO_CLASS")),
			combobox: weights(constant("src/components/ui/select.tsx", "CONTROL_CLASS")),
		}).toStrictEqual({
			selectionBar: ["font-control-regular"],
			turnChanges: ["font-control-regular"],
			combobox: ["font-control-regular"],
		});
	});

	it("--color-fill-button-ghost-hover is the ghost hover pre-rollout, and upstream's #0000001a / #ffffff13 under fizzy-lake color", () => {
		expect({
			theme: token(block("@theme inline"), "--color-fill-button-ghost-hover"),
			base: token(block(":root"), "--upstream-fill-button-ghost-hover"),
			color: token(block(':root[data-cds-fizzy-lake~="color"]'), "--upstream-fill-button-ghost-hover"),
			dark: token(block(':root.dark[data-cds-fizzy-lake~="color"]'), "--upstream-fill-button-ghost-hover"),
		}).toStrictEqual({
			theme: "var(--upstream-fill-button-ghost-hover)",
			base: "var(--upstream-fill-ghost-hover)",
			color: "#0000001a",
			dark: "#ffffff13",
		});
	});
});
