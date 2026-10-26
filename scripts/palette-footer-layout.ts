/**
 * Real-layout check for the ⌘K palette's keyboard-hint footer (upstream-sync palette-phone-footer task 3). jsdom has no
 * layout, so the unit tests can only pin the breakpoint classes; this drives headless Chromium against a running dev
 * server and checks that the Search view's footer stays one 40.5px line with upstream's visible hints at 390, 700 and
 * 1200px. Not part of precommit: run `just palette-footer-layout [--base-url http://127.0.0.1:PORT]` with a server up.
 */

import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium, type Page} from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:7526";
const FOOTER_HEIGHT_PX = 40.5;
const FOOTER_HEIGHT_TOLERANCE_PX = 0.5;
const HINT_HEIGHT_PX = 18;

export interface FooterLayoutCase {
	width: number;
	height: number;
	/** Upstream's visible hints, left to right, ending with the view hint's label. */
	labels: readonly string[];
}

/** Below md (768px) upstream hides Filters; below sm (640px) Change type as well. */
export const FOOTER_LAYOUT_CASES: readonly FooterLayoutCase[] = [
	{width: 390, height: 844, labels: ["Close", "Actions", "Compose"]},
	{width: 700, height: 844, labels: ["Close", "Change type", "Actions", "Compose"]},
	{width: 1200, height: 844, labels: ["Close", "Change type", "Filters", "Actions", "Compose"]},
];

export interface FooterMeasurement {
	height: number;
	scrollWidth: number;
	clientWidth: number;
	/** The displayed hint wrappers, left to right. */
	hints: ReadonlyArray<{label: string; height: number}>;
	/** The trailing view hint's label without its keycap, or null when it is absent. */
	viewHint: string | null;
}

export function footerLayoutFailures(measurement: FooterMeasurement, expectedLabels: readonly string[]): string[] {
	const failures: string[] = [];
	if (Math.abs(measurement.height - FOOTER_HEIGHT_PX) > FOOTER_HEIGHT_TOLERANCE_PX) {
		failures.push(
			`footer height ${measurement.height}px, expected ${FOOTER_HEIGHT_PX}px (±${FOOTER_HEIGHT_TOLERANCE_PX})`,
		);
	}
	if (measurement.scrollWidth > measurement.clientWidth) {
		failures.push(
			`footer overflows: scrollWidth ${measurement.scrollWidth} > clientWidth ${measurement.clientWidth}`,
		);
	}
	const labels = [
		...measurement.hints.map((hint) => hint.label),
		...(measurement.viewHint === null ? [] : [measurement.viewHint]),
	];
	if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) {
		failures.push(`visible hints ${JSON.stringify(labels)}, expected ${JSON.stringify(expectedLabels)}`);
	}
	for (const hint of measurement.hints) {
		if (hint.height !== HINT_HEIGHT_PX) {
			failures.push(`hint ${JSON.stringify(hint.label)} is ${hint.height}px tall, expected ${HINT_HEIGHT_PX}px`);
		}
	}
	return failures;
}

export interface FooterLayoutArgs {
	baseUrl: string;
}

export function parseFooterLayoutArgs(argv: readonly string[]): FooterLayoutArgs {
	let baseUrl = DEFAULT_BASE_URL;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--base-url") {
			const raw = argv[++index];
			if (raw === undefined) throw new Error("--base-url needs a URL");
			baseUrl = raw.replace(/\/+$/, "");
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return {baseUrl};
}

/** Opens ⌘K on Home and leaves it in the Search view with an empty query. */
async function openSearchPalette(page: Page, baseUrl: string): Promise<void> {
	await page.goto(`${baseUrl}/`, {waitUntil: "networkidle"});
	const footer = page.locator("[data-palette-footer]");
	await page.keyboard.press("ControlOrMeta+k");
	await footer.waitFor({state: "visible", timeout: 30_000});
	const searchHint = footer.getByRole("button", {name: "Search Tab"});
	if (await searchHint.isVisible()) {
		await searchHint.click();
		await footer.getByRole("button", {name: "Compose Tab"}).waitFor({state: "visible"});
	}
	// Let FooterCollapse's 150ms grid-rows transition settle.
	await page.waitForTimeout(300);
}

async function measureFooter(page: Page): Promise<FooterMeasurement> {
	return page.locator("[data-palette-footer]").evaluate((footer) => {
		const hints = [...footer.querySelectorAll<HTMLElement>("[data-palette-footer-hint]")]
			.filter((hint) => getComputedStyle(hint).display !== "none")
			.map((hint) => ({
				label: hint.firstElementChild?.textContent ?? "",
				height: hint.getBoundingClientRect().height,
			}));
		const button = footer.querySelector<HTMLElement>("button[aria-keyshortcuts=Tab]");
		const viewHint = button === null ? null : (button.firstChild?.textContent ?? "").trim();
		return {
			height: footer.getBoundingClientRect().height,
			scrollWidth: footer.scrollWidth,
			clientWidth: footer.clientWidth,
			hints,
			viewHint,
		};
	});
}

async function main(): Promise<void> {
	const {baseUrl} = parseFooterLayoutArgs(process.argv.slice(2));
	const browser = await chromium.launch();
	let failed = false;
	try {
		for (const layoutCase of FOOTER_LAYOUT_CASES) {
			const context = await browser.newContext({viewport: {width: layoutCase.width, height: layoutCase.height}});
			try {
				const page = await context.newPage();
				await openSearchPalette(page, baseUrl);
				const measurement = await measureFooter(page);
				const failures = footerLayoutFailures(measurement, layoutCase.labels);
				if (failures.length === 0) {
					console.log(`ok ${layoutCase.width}px: ${layoutCase.labels.join(" · ")}`);
				} else {
					failed = true;
					console.error(`FAIL ${layoutCase.width}px:\n  ${failures.join("\n  ")}`);
				}
			} finally {
				await context.close();
			}
		}
	} finally {
		await browser.close();
	}
	if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
