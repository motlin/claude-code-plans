import type {WorkflowInput} from "./tool-input-schemas";

/** Upstream c62b4c3e1 `f`: the `meta.name` literal near the top of an inline workflow script. */
const META_NAME_PATTERN = /\bmeta\s*=\s*\{[^}]*?\bname\s*:\s*['"]([^'"]+)['"]/;
const META_SCAN_CHARS = 4096;

/** Upstream `m5`: last path segment, tolerating one trailing separator and Windows paths. */
function pathBasename(path: string): string {
	const trimmed = path.replace(/[\\/]$/, "");
	const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return lastSeparator === -1 ? trimmed : trimmed.slice(lastSeparator + 1);
}

/** Upstream `Kc`: drop the final extension unless that leaves nothing. */
function stripExtension(fileName: string): string {
	return fileName.replace(/\.\w+$/, "") || fileName;
}

/**
 * Display name for a Workflow tool call, matching upstream c62b4c3e1 `m`:
 * `input.name`, then the script's `meta.name` (first 4096 chars), then the
 * extensionless basename of `input.scriptPath`.
 */
export function workflowName(input: WorkflowInput): string | undefined {
	if (input.name) return input.name;
	if (input.script !== undefined) {
		const match = META_NAME_PATTERN.exec(input.script.slice(0, META_SCAN_CHARS));
		if (match?.[1] !== undefined) return match[1];
	}
	if (input.scriptPath) return stripExtension(pathBasename(input.scriptPath));
	return undefined;
}
