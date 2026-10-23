#!/usr/bin/env node
// One-off: vendor upstream claude.ai WorkingMark loop sprite sheets into public/working-mark/.
// Usage: node scripts/vendor-working-mark.mjs [bundle-url]
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

const BUNDLE_URL = process.argv[2] ?? "https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/c8677db5f-yT2tYwzN.js";
const ACTIVITIES = ["default", "think", "search", "read", "code", "write", "compose", "blocked"];
const OUT_DIR = join(import.meta.dirname, "..", "public", "working-mark");

const source = await (await fetch(BUNDLE_URL)).text();

const urlByVar = new Map();
for (const match of source.matchAll(/([\w$]+)=new URL\("([^"]+)"/g)) {
	urlByVar.set(match[1], match[2]);
}
const table = /k=\{([^}]+)\};export/.exec(source)?.[1];
if (table === undefined) throw new Error("SHEET_URLS table not found");
const varBySheet = new Map();
for (const match of table.matchAll(/"?([\w.]+)"?:([\w$]+)/g)) {
	varBySheet.set(match[1], match[2]);
}

await mkdir(OUT_DIR, {recursive: true});
for (const activity of ACTIVITIES) {
	const url = urlByVar.get(varBySheet.get(`${activity}.loop`) ?? "");
	if (url === undefined) throw new Error(`no sheet for ${activity}.loop`);
	const bytes = url.startsWith("data:")
		? Buffer.from(url.slice(url.indexOf(",") + 1), "base64")
		: Buffer.from(await (await fetch(url)).arrayBuffer());
	await writeFile(join(OUT_DIR, `${activity}.webp`), bytes);
	console.log(`${activity}.webp ${bytes.length} bytes`);
}
