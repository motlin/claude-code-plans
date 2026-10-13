/** A file's path relative to the working directory, or null outside it. */
export function relativeToCwd(path: string, cwd: string | undefined): string | null {
	if (cwd === undefined) return null;
	const prefix = `${cwd.replace(/\/+$/, "")}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** The path an `@` mention uses: relative inside the working directory, absolute outside. */
export function mentionPath(path: string, cwd: string | undefined): string {
	return relativeToCwd(path, cwd) ?? path;
}
