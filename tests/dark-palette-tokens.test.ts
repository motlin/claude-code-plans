import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

/** The body of a top-level block (`@theme inline`, `:root`, `.dark`) of globals.css. */
function block(selector: string): string {
	const start = styles.indexOf(`\n${selector} {`);
	return styles.slice(start, styles.indexOf("\n}", start));
}

function tokens(selector: string, names: readonly string[]): Record<string, string | null> {
	const body = block(selector);
	return Object.fromEntries(
		names.map((name) => [name, body.match(new RegExp(`\\s${name}:\\s*([^;]+);`))?.[1] ?? null]),
	);
}

const GIT_STATES = ["opened", "draft", "merged", "closed", "conflicting", "queued"] as const;

describe("dark palette", () => {
	it("uses upstream's v2 near-black surfaces and neutral ink", () => {
		expect(
			tokens(".dark", [
				"--upstream-page",
				"--upstream-surface-0",
				"--upstream-surface-1",
				"--upstream-surface-2",
				"--upstream-surface-3",
				"--upstream-surface-popover",
				"--menu-bg",
				"--sb-bg",
				"--sb-hover",
				"--sb-selected",
				"--upstream-text-primary",
				"--upstream-text-muted",
				"--menu-muted",
				"--settings-muted",
				"--upstream-code-ink",
				"--upstream-accent",
				"--upstream-border",
				"--upstream-border-strong",
				"--upstream-fill-primary",
				"--upstream-fill-primary-hover",
				"--upstream-fill-ghost-hover",
			]),
		).toStrictEqual({
			"--upstream-page": "#151515",
			"--upstream-surface-0": "#0b0b0b",
			"--upstream-surface-1": "#151515",
			"--upstream-surface-2": "#1a1a19",
			"--upstream-surface-3": "#20201f",
			"--upstream-surface-popover": "#20201f",
			"--menu-bg": "#20201f",
			"--sb-bg": "#111",
			"--sb-hover": "hsl(0 0% 100% / 0.075)",
			"--sb-selected": "hsl(0 0% 100% / 0.15)",
			"--upstream-text-primary": "#f0efec",
			"--upstream-text-muted": "#898781",
			"--menu-muted": "#898781",
			"--settings-muted": "#898781",
			"--upstream-code-ink": "#ec7e7e",
			"--upstream-accent": "#6da7ec",
			"--upstream-border": "hsl(0 0% 100% / 0.1)",
			"--upstream-border-strong": "hsl(0 0% 100% / 0.2)",
			"--upstream-fill-primary": "#fff",
			"--upstream-fill-primary-hover": "#e1e0d9",
			"--upstream-fill-ghost-hover": "hsl(0 0% 100% / 0.075)",
		});
	});

	it("matches upstream's measured dark shadows, outlines, selection and ink (wave 90), leaving light alone", () => {
		const names = [
			"--composer-shadow-idle",
			"--card-outline",
			"--menu-shadow",
			"--sb-selected",
			"--sb-session-selected",
			"--upstream-on-primary",
			"--upstream-text-secondary",
		];

		expect({light: tokens(":root", names), dark: tokens(".dark", names)}).toStrictEqual({
			light: {
				"--composer-shadow-idle": "0 4px 20px rgb(0 0 0 / 0.035), 0 0 0 1px rgb(11 11 11 / 0.1)",
				"--card-outline": "hsl(0 0% 4% / 0.1)",
				"--menu-shadow":
					"0 0 0 1px rgb(11 11 11 / 0.1), 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08)",
				"--sb-selected": "#edece8",
				"--sb-session-selected": "var(--sb-selected)",
				"--upstream-on-primary": "hsl(0 0% 100%)",
				"--upstream-text-secondary": "rgb(82 81 78)",
			},
			dark: {
				"--composer-shadow-idle": "0 4px 20px rgb(0 0 0 / 0.035), inset 0 0 0 1px rgb(255 255 255 / 0.1)",
				"--card-outline": "hsl(0 0% 100% / 0.1)",
				"--menu-shadow":
					"inset 0 0 0 1px hsl(0 0% 100% / 0.1), 0 8px 24px rgba(0, 0, 0, 0.32), 0 2px 6px rgba(0, 0, 0, 0.2)",
				"--sb-selected": "hsl(0 0% 100% / 0.15)",
				"--sb-session-selected": "hsl(0 0% 100% / 0.075)",
				"--upstream-on-primary": "#0b0b0b",
				"--upstream-text-secondary": "#c3c2b7",
			},
		});
	});

	it("routes the git status colors through themed tokens with upstream's dark values", () => {
		const names = GIT_STATES.map((state) => `--git-${state}`);

		expect({
			theme: tokens(
				"@theme inline",
				GIT_STATES.map((state) => `--color-git-${state}`),
			),
			light: tokens(":root", names),
			dark: tokens(".dark", names),
		}).toStrictEqual({
			theme: {
				"--color-git-opened": "var(--git-opened)",
				"--color-git-draft": "var(--git-draft)",
				"--color-git-merged": "var(--git-merged)",
				"--color-git-closed": "var(--git-closed)",
				"--color-git-conflicting": "var(--git-conflicting)",
				"--color-git-queued": "var(--git-queued)",
			},
			light: {
				"--git-opened": "#1e9e3c",
				"--git-draft": "#737373",
				"--git-merged": "#8e6bd9",
				"--git-closed": "#ff3a30",
				"--git-conflicting": "#c5621b",
				"--git-queued": "#98801f",
			},
			dark: {
				"--git-opened": "#32d74b",
				"--git-draft": "#a6a6a6",
				"--git-merged": "#b796ff",
				"--git-closed": "#ff6159",
				"--git-conflicting": "#fa832e",
				"--git-queued": "#ffd014",
			},
		});
	});
});
