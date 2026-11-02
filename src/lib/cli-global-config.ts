import {chmod, mkdir, readFile, rename, rm, rmdir, stat, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {applyEdits, modify} from "jsonc-parser";
import {errnoCode, isRecord} from "./narrow";

/*
 * The CLI's global config, `<CLAUDE_CONFIG_DIR or home>/.claude.json`. The CLI saves it under a proper-lockfile
 * lock (a `.claude.json.lock` directory, stale after 10s) and re-reads it under that lock, so a write here takes the
 * same lock and edits only its own key, leaving every other byte as the CLI wrote it.
 */

const CONFIG_FILENAME = ".claude.json";
/** proper-lockfile's default `stale`. */
const STALE_LOCK_MS = 10_000;
const LOCK_RETRY_DELAYS_MS = [10, 20, 50, 100, 200, 400, 800, 1600];

export function defaultCliConfigDir(env: Readonly<Record<string, string | undefined>> = process.env): string
{
	return env["CLAUDE_CONFIG_DIR"] ?? homedir();
}

function configPathIn(configDir: string): string
{
	return join(configDir, CONFIG_FILENAME);
}

/** A top-level `true` flag in the CLI's global config; false when the file is missing or unreadable. */
export async function readCliConfigFlag(configDir: string, key: string): Promise<boolean>
{
	try
	{
		const raw: unknown = JSON.parse(await readFile(configPathIn(configDir), "utf-8"));
		return isRecord(raw) && raw[key] === true;
	}
	catch
	{
		return false;
	}
}

async function acquireLock(lockPath: string): Promise<void>
{
	for (let attempt = 0; ; attempt++)
	{
		try
		{
			await mkdir(lockPath);
			return;
		}
		catch (error)
		{
			if (errnoCode(error) !== "EEXIST") throw error;
		}
		const lockStat = await stat(lockPath).catch(() => null);
		if (lockStat !== null && Date.now() - lockStat.mtimeMs > STALE_LOCK_MS)
		{
			await rmdir(lockPath).catch(() => undefined);
			continue;
		}
		const delay = LOCK_RETRY_DELAYS_MS[attempt];
		if (delay === undefined) throw new Error(`${lockPath} is held by another process`);
		await new Promise<void>((resolve) =>
		{
			setTimeout(resolve, delay);
		});
	}
}

async function readConfigText(path: string): Promise<
{
	text: string;
	mode: number;
} | null>
{
	try
	{
		const {mode} = await stat(path);
		return {
			text: await readFile(path, "utf-8"),
			mode: mode & 0o777,
		};
	}
	catch (error)
	{
		if (errnoCode(error) === "ENOENT") return null;
		throw error;
	}
}

/**
 * Set a top-level `true` flag in the CLI's global config, as the CLI's own `saveGlobalConfig` does. Creates the file
 * when the CLI hasn't, does nothing when the flag is already set, and refuses (throws) rather than overwrite a file
 * that isn't a JSON object.
 */
export async function setCliConfigFlag(configDir: string, key: string): Promise<void>
{
	const path = configPathIn(configDir);
	const lockPath = `${path}.lock`;
	await mkdir(
		configDir,
		{
			recursive: true,
		},
	);
	await acquireLock(lockPath);
	try
	{
		const current = await readConfigText(path);
		const text = current?.text ?? "{}";
		const parsed: unknown = JSON.parse(text);
		if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`);
		if (parsed[key] === true) return;
		const edited = applyEdits(
			text,
			modify(
				text,
				[key],
				true,
				{
					formattingOptions:
					{
						insertSpaces: true,
						tabSize: 2,
						eol: "\n",
					},
				},
			),
		);
		const temporaryPath = join(configDir, `${CONFIG_FILENAME}.tmp.${process.pid}.${crypto.randomUUID()}`);
		try
		{
			await writeFile(
				temporaryPath,
				edited,
				{
					encoding: "utf-8",
					flag: "wx",
					mode: current?.mode ?? 0o600,
				},
			);
			if (current !== null) await chmod(temporaryPath, current.mode);
			await rename(temporaryPath, path);
		}
		catch (error)
		{
			await rm(
				temporaryPath,
				{
					force: true,
				},
			);
			throw error;
		}
	}
	finally
	{
		await rmdir(lockPath).catch(() => undefined);
	}
}
