import {readdir, readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {StatuslineSchema} from "./api/statusline";
import {EMPTY_USAGE, type UsageSummary, type UsageWindow} from "./usage";

function toWindow(window: {used_percentage: number; resets_at: number} | undefined): UsageWindow | null {
	return window ? {usedPct: window.used_percentage, resetsAt: window.resets_at} : null;
}

/** Rate limits from the most recently modified statusline in `statuslineDirectory`. */
export async function readLatestUsage(statuslineDirectory: string): Promise<UsageSummary> {
	let names: string[];
	try {
		names = (await readdir(statuslineDirectory)).filter((name) => name.endsWith(".json"));
	} catch {
		return EMPTY_USAGE;
	}

	const files = await Promise.all(
		names.map(async (name) => {
			const filePath = join(statuslineDirectory, name);
			try {
				return {filePath, mtimeMs: (await stat(filePath)).mtimeMs};
			} catch {
				return null;
			}
		}),
	);
	const newestFirst = files.filter((file) => file !== null).sort((left, right) => right.mtimeMs - left.mtimeMs);

	for (const {filePath, mtimeMs} of newestFirst) {
		let json: unknown;
		try {
			json = JSON.parse(await readFile(filePath, "utf-8"));
		} catch {
			continue;
		}
		const parsed = StatuslineSchema.safeParse(json);
		if (!parsed.success) continue;
		return {
			fiveHour: toWindow(parsed.data.rate_limits?.five_hour),
			sevenDay: toWindow(parsed.data.rate_limits?.seven_day),
			updatedAt: new Date(mtimeMs).toISOString(),
		};
	}
	return EMPTY_USAGE;
}
