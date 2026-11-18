/** Upstream's macOS/Linux home prefix, the same rule `shortenCwd` uses. */
const HOME_PREFIX = /^\/(?:Users|home)\/[^/]+(?=\/|$)/;

export interface FolderRowName
{
	/** The folder's basename, or `/` for the root. */
	name: string;
	/** The shortened parent folder, set only when another listed folder shares the basename. */
	parent: string | undefined;
}

/** `/Users/me/x` or `/home/me/x` → `~/x`, like upstream's shortened local cwd. */
export function shortenCwd(path: string): string
{
	return path.replace(HOME_PREFIX, "~");
}

/** The home directory of the first path under `/Users/<u>` or `/home/<u>`. */
export function inferHome(paths: readonly string[]): string | undefined
{
	for (const path of paths)
	{
		const match = HOME_PREFIX.exec(path);
		if (match !== null) return match[0];
	}
	return undefined;
}

/** Upstream's `HR`: `~`-relative when strictly below home, else absolute; undefined only for the root. */
function parentFolder(path: string, home: string | undefined): string | undefined
{
	if (path === "/") return undefined;
	const cut = path.lastIndexOf("/");
	const parent = cut <= 0 ? "/" : path.slice(0, cut);
	if (home === undefined) return parent;
	if (parent === home) return "~";
	return parent.startsWith(`${home}/`) ? `~${parent.slice(home.length)}` : parent;
}

/** Upstream's folder-row name: the folder's basename, or `/` for the root. */
export function folderName(path: string): string
{
	return path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Upstream's folder-row parent (c3f9f1667 `V`/`X` over shared `BF`): the full shortened parent folder, only when
 * another folder in `paths` has the same basename (case-sensitive). Upstream's shortest-unique-suffix walk only gates
 * whether the parent shows, so it reduces to that collision check here.
 */
export function folderParent(path: string, paths: readonly string[], home: string | undefined): string | undefined
{
	const name = folderName(path);
	const collides = paths.some((other) => other !== path && folderName(other) === name);
	return collides ? parentFolder(path, home) : undefined;
}

/** Upstream's names for a list of folder rows, each disambiguated against the others. */
export function folderRowNames(paths: readonly string[], home: string | undefined): FolderRowName[]
{
	return paths.map((path) => (
	{
		name: folderName(path),
		parent: folderParent(path, paths, home),
	}));
}
