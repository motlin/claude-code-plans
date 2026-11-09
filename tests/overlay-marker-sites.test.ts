import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return name.endsWith(".tsx") ? [path] : [];
	});
}

/** The JSX opening tag starting at `start`: up to its own line-ending `>` or a self-closing `/>`. */
function openingTag(text: string, start: number): string {
	const rest = text.slice(start);
	const ends = [rest.indexOf("/>"), rest.search(/\n\t*>/u)].filter((index) => index !== -1);
	return rest.slice(0, Math.min(...ends));
}

/** Every Base UI `<X.Popup` opening in `src/`, keyed `file:Namespace`, and whether it stamps the overlay marker. */
function popupSites(): Record<string, boolean> {
	const sites: Record<string, boolean> = {};
	for (const path of sources("src").toSorted()) {
		const text = readFileSync(path, "utf8");
		for (const match of text.matchAll(/<(\w+)\.Popup\b/gu)) {
			const tag = openingTag(text, match.index);
			const key = `${path.replace(/^src\/components\//u, "")}:${match[1]}`;
			sites[key] = (sites[key] ?? true) && /overlayAttrs|data-cds-overlay/u.test(tag);
		}
	}
	return sites;
}

describe("data-cds-overlay popup sites", () => {
	it("stamps every Dialog, AlertDialog, Menu and Popover popup and leaves upstream's unmarked kinds alone", () => {
		expect(popupSites()).toStrictEqual({
			"coach-mark.tsx:Popover": false,
			"composer-skill-chip.tsx:PreviewCard": false,
			"home/project-picker.tsx:Popover": true,
			"refusal-fallback-card.tsx:PreviewCard": false,
			"session-hover-card.tsx:PreviewCard": false,
			"settings/settings-search.tsx:Popover": true,
			"slash-command-chip.tsx:PreviewCard": false,
			"stale-compact-band.tsx:Popover": false,
			"step-screenshot-strip.tsx:PreviewCard": false,
			"ui/dialog-popup.tsx:AlertDialog": true,
			"ui/dialog-popup.tsx:Dialog": true,
			"ui/info-tip.tsx:Popover": false,
			"ui/menu-sheet.tsx:BaseMenu": true,
			"ui/menu.tsx:BaseMenu": true,
			"ui/popover-sheet.tsx:BasePopover": true,
			"ui/popover.tsx:BasePopover": true,
			"ui/select.tsx:BaseSelect": false,
		});
	});

	it("renders every Dialog and AlertDialog popup through ui/dialog-popup.tsx (overlay-stacked-focus-handoff T3)", () => {
		const direct = sources("src")
			.toSorted()
			.filter((path) => path !== join("src", "components", "ui", "dialog-popup.tsx"))
			.filter((path) => /<(?:Alert)?Dialog\.Popup\b/u.test(readFileSync(path, "utf8")));
		expect(direct).toStrictEqual([]);
	});
});
