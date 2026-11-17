import {assertNever} from "./assert-never";

/**
 * The Memory dialog's rows, ported from upstream's `EpitaxyMemoryDialog` model (`Me`/`je`, chunk c33497182):
 * the session's CLAUDE files from its context breakdown, with placeholders for a missing User and Project file.
 */

/** Upstream `De`: auto-memory has its own surface, so the dialog keeps only these. */
const MEMORY_TYPES: ReadonlySet<string> = new Set(["Managed", "User", "Project", "Local"]);

export type MemoryRowKind = "managed" | "user" | "project" | "nested" | "imported" | "other";

export interface MemoryRow
{
	path: string;
	type: string;
	kind: MemoryRowKind;
	label: string;
	displayPath: string;
	exists: boolean;
	readable: boolean;
	openable: boolean;
}

function trimSlash(path: string): string
{
	return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function baseName(path: string): string
{
	const trimmed = trimSlash(path);
	return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** Upstream `ke`: the parent directory. */
function parentDir(path: string): string
{
	const trimmed = trimSlash(path);
	return trimmed.slice(0, Math.max(trimmed.lastIndexOf("/"), 1));
}

function samePath(a: string, b: string | undefined): boolean
{
	return b !== undefined && trimSlash(a) === trimSlash(b);
}

function inside(path: string, dir: string): boolean
{
	return path.startsWith(`${trimSlash(dir)}/`);
}

/** Upstream `N`: relative to the working directory inside it, `~/…` under home, else the path. */
export function memoryDisplayPath(path: string, cwd: string | undefined, home: string | undefined): string
{
	if (!path.startsWith("/")) return path;
	if (cwd !== undefined && inside(path, cwd)) return path.slice(trimSlash(cwd).length + 1);
	if (home !== undefined && inside(path, home)) return `~/${path.slice(trimSlash(home).length + 1)}`;
	return path;
}

/** Upstream `Ae`: a User `CLAUDE.md` outside a `rules/` folder is the user file. */
function isUserFile(file: {path: string; type: string}): boolean
{
	return file.type === "User" && baseName(file.path) === "CLAUDE.md" && baseName(parentDir(file.path)) !== "rules";
}

/** Upstream `je`. */
function rowKind(
	file:
	{
		path: string;
		type: string;
	},
	projectFile: string | undefined,
	cwd: string | undefined,
	user: boolean,
): MemoryRowKind
{
	if (user) return "user";
	if (file.type === "Project" && samePath(file.path, projectFile)) return "project";
	const name = baseName(file.path);
	if (name !== "CLAUDE.md" && name !== "CLAUDE.local.md")
	{
		return file.path.includes("/.claude/rules/") ||
			(file.type === "User" && baseName(parentDir(file.path)) === "rules")
			? "other"
			: "imported";
	}
	const dir = parentDir(file.path);
	return (file.type === "Project" || file.type === "Local") &&
		cwd !== undefined &&
		inside(file.path, cwd) &&
		!samePath(dir, cwd) &&
		baseName(dir) !== ".claude"
		? "nested"
		: "other";
}

function rowLabel(kind: MemoryRowKind, path: string, displayPath: string): string
{
	if (kind === "user") return "User instructions";
	if (kind === "project") return "Project instructions";
	return kind === "managed" ? path : displayPath;
}

/**
 * Upstream `Me`: the breakdown's Managed/User/Project/Local files in order, a not-created `~/.claude/CLAUDE.md`
 * spliced in before the first non-Managed row when no user file is listed, and a not-created `<cwd>/CLAUDE.md`
 * before the first Local or nested row when no project file is. Only absolute paths can open; a listed one reads.
 */
export function memoryDialogRows({
	memoryFiles,
	cwd,
	home,
}: {
	memoryFiles: readonly
	{
		path: string;
		type: string;
	}[];
	cwd: string | undefined;
	home: string | undefined;
}): MemoryRow[]
{
	const userFile = home === undefined ? undefined : `${trimSlash(home)}/.claude/CLAUDE.md`;
	const projectFile = cwd === undefined ? undefined : `${trimSlash(cwd)}/CLAUDE.md`;
	const row = (
		file:
		{
			path: string;
			type: string;
		},
		exists: boolean,
		user: boolean,
	): MemoryRow =>
	{
		const openable = file.path.startsWith("/");
		const kind: MemoryRowKind =
			file.type === "Managed" ? "managed" : openable ? rowKind(file, projectFile, cwd, user) : "other";
		const displayPath = memoryDisplayPath(file.path, cwd, home);
		return {
			path: file.path,
			type: file.type,
			kind,
			label: rowLabel(kind, file.path, displayPath),
			displayPath,
			exists,
			readable: exists && openable,
			openable,
		};
	};
	let userSeen = false;
	const rows = memoryFiles
		.filter((file) => MEMORY_TYPES.has(file.type))
		.map((file) =>
		{
			const user = !userSeen && isUserFile(file);
			userSeen ||= user;
			return row(
				{
					path: file.path,
					type: file.type,
				},
				true,
				user,
			);
		});
	if (userFile !== undefined && !rows.some((r) => r.kind === "user"))
	{
		const index = rows.findIndex((r) => r.type !== "Managed");
		rows.splice(
			index === -1 ? rows.length : index,
			0,
			row(
				{
					type: "User",
					path: userFile,
				},
				false,
				true,
			),
		);
	}
	if (projectFile !== undefined && !rows.some((r) => r.kind === "project"))
	{
		const index = rows.findIndex((r) => r.type === "Local" || r.kind === "nested");
		rows.splice(
			index === -1 ? rows.length : index,
			0,
			row(
				{
					type: "Project",
					path: projectFile,
				},
				false,
				false,
			),
		);
	}
	return rows;
}

/** Upstream `We`: newlines, plus one for a last line without one; an empty file has none. */
export function memoryLineCount(text: string): number
{
	if (text.length === 0) return 0;
	const newlines = text.split("\n").length - 1;
	return text.endsWith("\n") ? newlines : newlines + 1;
}

export const MEMORY_NOT_CREATED = "not created yet";
const MEMORY_OUTSIDE = "Outside this session’s working directory, so it can’t open here.";
const MEMORY_SET_BY_ORG = "Managed by your organization";
export const MEMORY_VIEW_ONLY = "view only";

/** Why a row can't open, for its title, sr-only note and the disabled Open's reason; undefined when it can. */
export function memoryRowNote(row: MemoryRow): string | undefined
{
	if (!row.exists) return MEMORY_NOT_CREATED;
	if (row.readable) return undefined;
	return row.kind === "managed" ? MEMORY_SET_BY_ORG : MEMORY_OUTSIDE;
}

/** Upstream `He`'s facts line: "@-imported", then why it can't open, or its line count and "view only". */
export function memoryFileFacts(
	row: MemoryRow,
	read:
		|
		  {
				lines: number;
				writable: boolean;
		  }
		| undefined,
): string
{
	const facts: string[] = [];
	if (row.kind === "imported") facts.push("@-imported");
	const note = memoryRowNote(row);
	if (note !== undefined) facts.push(note);
	else if (read !== undefined)
	{
		const lines = `${read.lines} ${read.lines === 1 ? "line" : "lines"}`;
		facts.push(
			row.kind === "nested"
				? `${lines} · read when Claude works in that folder`
				: `${lines} · read at session start`,
		);
		if (!read.writable) facts.push(MEMORY_VIEW_ONLY);
	}
	return facts.join(" · ");
}

/**
 * Upstream's dialog-level unsaved-changes guard (`R`/`Xe`/`Pt`): `dirtyPath` is the file whose edits would be lost,
 * `pending` the action held behind the "Discard unsaved changes?" confirm.
 */
export interface DiscardGuardState<A>
{
	dirtyPath: string | undefined;
	pending: A | null;
}

export type DiscardGuardEvent<A> =
	|
	  {
			type: "guard";
			action: A;
	  }
	|
	  {
			type: "dirty";
			path: string | undefined;
			dirty: boolean;
	  }
	|
	  {
			type: "discard";
	  }
	|
	  {
			type: "keep";
	  };

/** `run` is the action to perform now, if any. */
export interface DiscardGuardTransition<A>
{
	state: DiscardGuardState<A>;
	run: A | null;
}

/**
 * A guarded action runs at once while clean, is held behind the confirm while dirty, and is dropped while a confirm
 * is already open. Turning clean with an action held runs it (a retry or queued save landed behind the confirm);
 * Discard runs it and forgets the dirty file; Keep editing drops it.
 */
export function reduceDiscardGuard<A>(
	state: DiscardGuardState<A>,
	event: DiscardGuardEvent<A>,
): DiscardGuardTransition<A>
{
	switch (event.type)
	{
		case "guard":
			if (state.dirtyPath === undefined)
				return {
					state,
					run: event.action,
				};
			return {
				state:
					state.pending === null
						?
							{
								...state,
								pending: event.action,
							}
						: state,
				run: null,
			};
		case "dirty":
			if (event.dirty)
				return {
					state:
					{
						...state,
						dirtyPath: event.path,
					},
					run: null,
				};
			return {
				state:
				{
					dirtyPath: undefined,
					pending: null,
				},
				run: state.pending,
			};
		case "discard":
			return {
				state:
				{
					dirtyPath: undefined,
					pending: null,
				},
				run: state.pending,
			};
		case "keep":
			return {
				state:
				{
					...state,
					pending: null,
				},
				run: null,
			};
		default:
			return assertNever(event);
	}
}
