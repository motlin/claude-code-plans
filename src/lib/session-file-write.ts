import {chmod, realpath, rename, rm, stat, writeFile} from "node:fs/promises";
import {basename, dirname, isAbsolute, join, relative, sep} from "node:path";

/**
 * Writes from the Files source editor, the local stand-in for upstream's desktop
 * `LocalSessions.writeSessionFile`: which paths may be written, and the atomic write itself.
 */

/** Resolve every symlink in the longest existing prefix of `path`, keeping the missing rest as written. */
export async function realpathOfExistingPrefix(path: string): Promise<string>
{
	try
	{
		return await realpath(path);
	}
	catch
	{
		const parent = dirname(path);
		return parent === path ? path : join(await realpathOfExistingPrefix(parent), basename(path));
	}
}

function insideRoot(path: string, root: string): string[] | null
{
	const rel = relative(root, path);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
	return rel.split(sep);
}

/**
 * True iff `path` is absolute, has no `..` segment, resolves (symlinks included; the parent for a
 * new file) inside one of `roots`, and is not under a `.git` directory.
 */
export async function writableWorkspacePath(path: string, roots: readonly string[]): Promise<boolean>
{
	if (!isAbsolute(path) || path.includes("\0") || path.split(/[/\\]/).includes("..")) return false;
	const resolved = await realpathOfExistingPrefix(path);
	const resolvedRoots = await Promise.all(roots.map(async (root) => realpath(root).catch(() => root)));
	return resolvedRoots.some((root) =>
	{
		const segments = insideRoot(resolved, root);
		return segments !== null && !segments.includes(".git");
	});
}

const REPLACEMENT = 0xfffd;
const REPLACEMENT_BYTES = Buffer.from("�", "utf8");

function countReplacementBytes(bytes: Buffer): number
{
	let count = 0;
	for (
		let index = bytes.indexOf(REPLACEMENT_BYTES);
		index !== -1;
		index = bytes.indexOf(REPLACEMENT_BYTES, index + 3)
	)
		count += 1;
	return count;
}

/** Upstream `Rp`/`Bd`: decoding put a U+FFFD where the raw bytes had none, so saving would lose bytes. */
export function isLossyDecode(bytes: Buffer, text: string): boolean
{
	let decoded = 0;
	for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === REPLACEMENT) decoded += 1;
	return decoded > countReplacementBytes(bytes);
}

/** Replace `path` with `text` through a temp file in the same directory and a rename, keeping its mode. */
export async function writeFileAtomically(path: string, text: string): Promise<void>
{
	const temporaryPath = join(dirname(path), `.${basename(path)}-${crypto.randomUUID()}.tmp`);
	const mode = await stat(path).then(
		(existing) => existing.mode & 0o7777,
		() => null,
	);
	try
	{
		await writeFile(
			temporaryPath,
			text,
			{
				encoding: "utf-8",
				flag: "wx",
			},
		);
		if (mode !== null) await chmod(temporaryPath, mode);
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
