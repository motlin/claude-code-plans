import {readdir, readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {StatuslineSchema} from "./api/statusline";
import {ClaudeJsonCachedUsageSchema} from "./runtime-schemas";
import {EMPTY_USAGE, type ScopedUsage, type UsageSummary, type UsageWindow} from "./usage";

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The keys of `cachedUsageUtilization` the reader needs, picked out of the churning body. */
export function pickCachedUsage(cache: Record<string, unknown>): Record<string, unknown> | null
{
	const utilization = cache["utilization"];
	if (!isRecord(utilization)) return null;
	const picked: Record<string, unknown> = {};
	for (const key of ["fetchedAtMs", "accountUuid"])
	{
		if (key in cache) picked[key] = cache[key];
	}
	const body: Record<string, unknown> = {};
	for (const key of ["limits", "weekly_scoped_shares"])
	{
		if (key in utilization) body[key] = utilization[key];
	}
	picked["utilization"] = body;
	return picked;
}

/**
 * The model-scoped weekly rows the CLI cached from its last usage fetch (`~/.claude.json`
 * `cachedUsageUtilization`). Null unless the cache belongs to the signed-in account, was not
 * fetched in the future, and its `weekly_all` window has not reset since.
 */
async function readScopedUsage(homeDirectory: string, nowMs: number): Promise<ScopedUsage | null>
{
	let raw: unknown;
	try
	{
		raw = JSON.parse(await readFile(join(homeDirectory, ".claude.json"), "utf-8"));
	}
	catch
	{
		return null;
	}
	if (!isRecord(raw)) return null;
	const cache = raw["cachedUsageUtilization"];
	if (!isRecord(cache)) return null;
	const picked = pickCachedUsage(cache);
	const parsed = picked === null ? null : ClaudeJsonCachedUsageSchema.safeParse(picked);
	if (parsed?.success !== true) return null;
	const {fetchedAtMs, accountUuid, utilization} = parsed.data;
	const account = raw["oauthAccount"];
	const signedIn =
		isRecord(account) && typeof account["accountUuid"] === "string" ? account["accountUuid"] : undefined;
	if (accountUuid !== signedIn || fetchedAtMs > nowMs) return null;
	const limits = utilization.limits ?? [];
	const weeklyReset = limits.find((limit) => limit.kind === "weekly_all")?.resets_at;
	if (weeklyReset == null || !(Date.parse(weeklyReset) > nowMs)) return null;
	return {
		limits,
		shares: utilization.weekly_scoped_shares ?? [],
		fetchedAt: new Date(fetchedAtMs).toISOString(),
	};
}

function toWindow(
	window:
		|
		  {
				used_percentage: number;
				resets_at: number;
		  }
		| undefined,
): UsageWindow | null
{
	return window
		?
			{
				usedPct: window.used_percentage,
				resetsAt: window.resets_at,
			}
		: null;
}

/**
 * Rate limits from the most recently modified statusline in `statuslineDirectory`, plus the
 * scoped weekly rows cached in `<homeDirectory>/.claude.json`. The statusline stays the source of
 * the windows (it is fresher); the cache only adds what the statusline never carries.
 */
export async function readLatestUsage(
	statuslineDirectory: string,
	homeDirectory: string,
	nowMs: number = Date.now(),
): Promise<UsageSummary>
{
	const [windows, scoped] = await Promise.all([
		readStatuslineWindows(statuslineDirectory),
		readScopedUsage(homeDirectory, nowMs),
	]);
	return {
		...windows,
		scoped,
	};
}

async function readStatuslineWindows(statuslineDirectory: string): Promise<Omit<UsageSummary, "scoped">>
{
	let names: string[];
	try
	{
		names = (await readdir(statuslineDirectory)).filter((name) => name.endsWith(".json"));
	}
	catch
	{
		return EMPTY_USAGE;
	}

	const files = await Promise.all(
		names.map(async (name) =>
		{
			const filePath = join(statuslineDirectory, name);
			try
			{
				return {
					filePath,
					mtimeMs: (await stat(filePath)).mtimeMs,
				};
			}
			catch
			{
				return null;
			}
		}),
	);
	const newestFirst = files.filter((file) => file !== null).toSorted((left, right) => right.mtimeMs - left.mtimeMs);

	for (const {filePath, mtimeMs} of newestFirst)
	{
		let json: unknown;
		try
		{
			json = JSON.parse(await readFile(filePath, "utf-8"));
		}
		catch
		{
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
