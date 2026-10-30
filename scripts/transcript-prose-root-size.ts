/**
 * Real-layout check that transcript prose scales with the root font size (commit 8451a349): a browser text zoom raises
 * the root font size, and upstream's rem prose grows with it. jsdom has no layout, so this drives headless Chromium
 * against a running dev server, sets `html{font-size:20px}` on a read-only session view at Transcript text size Medium,
 * and checks the first transcript markdown paragraph measures 17.5px / 25px (.875rem at a 1.42857 leading). Not part of
 * precommit: run `just transcript-prose-root-size [--base-url http://127.0.0.1:PORT] [--session ID]` with a server up.
 */

import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium, type Page} from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:7526";
export const ROOT_FONT_SIZE_PX = 20;
const EXPECTED_FONT_SIZE_PX = 17.5;
const EXPECTED_LINE_HEIGHT_PX = 25;
const TOLERANCE_PX = 0.5;

export interface ProseMeasurement {
	fontSize: number;
	lineHeight: number;
}

export function proseRootSizeFailures(measurement: ProseMeasurement): string[] {
	const failures: string[] = [];
	if (Math.abs(measurement.fontSize - EXPECTED_FONT_SIZE_PX) > TOLERANCE_PX) {
		failures.push(
			`prose font size ${measurement.fontSize}px, expected ${EXPECTED_FONT_SIZE_PX}px (±${TOLERANCE_PX})`,
		);
	}
	if (Math.abs(measurement.lineHeight - EXPECTED_LINE_HEIGHT_PX) > TOLERANCE_PX) {
		failures.push(
			`prose line height ${measurement.lineHeight}px, expected ${EXPECTED_LINE_HEIGHT_PX}px (±${TOLERANCE_PX})`,
		);
	}
	return failures;
}

export interface ProseRootSizeArgs {
	baseUrl: string;
	/** The session to open, or null for the first one the Sessions page lists. */
	session: string | null;
}

export function parseProseRootSizeArgs(argv: readonly string[]): ProseRootSizeArgs {
	let baseUrl = DEFAULT_BASE_URL;
	let session: string | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--base-url") {
			const raw = argv[++index];
			if (raw === undefined) throw new Error("--base-url needs a URL");
			baseUrl = raw.replace(/\/+$/, "");
		} else if (argument === "--session") {
			const raw = argv[++index];
			if (raw === undefined) throw new Error("--session needs a session id");
			session = raw;
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return {baseUrl, session};
}

async function firstSessionId(page: Page, baseUrl: string): Promise<string> {
	await page.goto(`${baseUrl}/sessions`, {waitUntil: "networkidle"});
	const link = page.locator('a[href^="/session/"]').first();
	await link.waitFor({state: "attached", timeout: 30_000});
	const href = (await link.getAttribute("href")) ?? "";
	const id = href.replace(/^\/session\//, "").split(/[/?#]/)[0];
	if (id === undefined || id === "") throw new Error(`no session id in ${JSON.stringify(href)}`);
	return id;
}

async function measureProse(page: Page): Promise<ProseMeasurement> {
	const paragraph = page.locator(`.transcript-text [class*="markdown"] p`).first();
	await paragraph.waitFor({state: "visible", timeout: 30_000});
	return paragraph.evaluate((element) => {
		const style = getComputedStyle(element);
		return {fontSize: Number.parseFloat(style.fontSize), lineHeight: Number.parseFloat(style.lineHeight)};
	});
}

async function main(): Promise<void> {
	const {baseUrl, session} = parseProseRootSizeArgs(process.argv.slice(2));
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({viewport: {width: 1200, height: 900}});
		await context.addInitScript(() => {
			localStorage.setItem("ccp-transcript-text-size", "md");
		});
		const page = await context.newPage();
		const id = session ?? (await firstSessionId(page, baseUrl));
		await page.goto(`${baseUrl}/session/${encodeURIComponent(id)}`, {waitUntil: "networkidle"});
		await page.addStyleTag({content: `html { font-size: ${ROOT_FONT_SIZE_PX}px !important; }`});
		const measurement = await measureProse(page);
		const failures = proseRootSizeFailures(measurement);
		if (failures.length === 0) {
			console.log(
				`ok session ${id}: prose ${measurement.fontSize}px / ${measurement.lineHeight}px at a ${ROOT_FONT_SIZE_PX}px root`,
			);
		} else {
			process.exitCode = 1;
			console.error(`FAIL session ${id}:\n  ${failures.join("\n  ")}`);
		}
	} finally {
		await browser.close();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
