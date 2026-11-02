import {realpathSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";

/**
 * The canonical form of `path`: absolute, with every symlink resolved. The
 * recursive watcher reports events under its roots' real paths, so every
 * `~/.claude` directory and every hook-reported path is compared and keyed in
 * this form; otherwise a symlinked `~/.claude` makes the same file look like two.
 * A path that does not exist (yet, or any more) keeps its missing tail under the
 * real path of its nearest existing ancestor.
 */
export function canonicalPath(path: string): string
{
	const absolute = resolve(path);
	try
	{
		return realpathSync(absolute);
	}
	catch
	{
		const parent = dirname(absolute);
		if (parent === absolute) return absolute;
		return join(canonicalPath(parent), basename(absolute));
	}
}
