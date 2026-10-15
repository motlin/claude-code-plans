import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");
const source = (path: string) => readFileSync(path, "utf8");

function token(selector: string, name: string): string | null {
	const start = styles.indexOf(`\n${selector} {`);
	const body = styles.slice(start, styles.indexOf("\n}", start));
	return body.match(new RegExp(`\\s${name}:\\s*([^;]+);`))?.[1] ?? null;
}

describe("settings dialog in dark (wave 90, W90-13)", () => {
	it("uses upstream's surface-2 content pane and measured shadow tail, leaving light alone", () => {
		const dialog = source("src/components/settings/settings-dialog.tsx");

		expect({
			pane: dialog.includes("bg-[var(--menu-bg)] dark:bg-surface-2"),
			darkShadow: dialog.includes(
				"dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgba(0,0,0,0.24)]",
			),
			lightShadow: dialog.includes(
				"not-dark:shadow-[0_0_0_1px_rgb(11_11_11/0.1),0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgb(11_11_11/0.08)]",
			),
		}).toStrictEqual({pane: true, darkShadow: true, lightShadow: true});
	});

	it("divides rows at white/0.05 and draws the segmented control on a white/0.05 track with secondary ink", () => {
		expect({
			rowDivider: source("src/components/settings/settings-row.tsx").includes(
				"dark:[&>:not([hidden])~:not([hidden])]:border-white/5",
			),
			segmentedInk: source("src/components/settings/segmented-control.tsx").includes(
				"text-[var(--settings-segmented-ink)]",
			),
			light: {
				track: token(":root", "--settings-segmented-track"),
				ink: token(":root", "--settings-segmented-ink"),
			},
			dark: {
				track: token(".dark", "--settings-segmented-track"),
				ink: token(".dark", "--settings-segmented-ink"),
			},
		}).toStrictEqual({
			rowDivider: true,
			segmentedInk: true,
			light: {track: "rgb(11 11 11 / 0.05)", ink: "var(--settings-muted)"},
			dark: {track: "hsl(0 0% 100% / 0.05)", ink: "var(--upstream-text-secondary)"},
		});
	});
});
