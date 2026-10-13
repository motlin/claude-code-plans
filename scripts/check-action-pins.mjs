#!/usr/bin/env node
// Fail when a GitHub Action is pinned to more than one ref across workflows and composite actions,
// so a partial version bump cannot leave the repo split between two versions of the same action.
//
// Usage: node scripts/check-action-pins.mjs

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

const USES = /^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)["']?\s*(?:#\s*(.*?))?\s*$/u;
const REMOTE = /^([^/@]+\/[^/@]+)(?:\/[^@]*)?@(.+)$/u;

/**
 * @param {{path: string, content: string}[]} files
 * @returns {{action: string, occurrences: {file: string, line: number, ref: string, comment: string | undefined}[]}[]}
 */
export function findPinConflicts(files) {
	/** @type {Map<string, {file: string, line: number, ref: string, comment: string | undefined}[]>} */
	const byAction = new Map();
	for (const {path, content} of files) {
		content.split("\n").forEach((text, index) => {
			const uses = USES.exec(text);
			const target = uses?.[1];
			if (target === undefined || target === "" || target.startsWith("./") || target.startsWith("docker://")) {
				return;
			}
			const remote = REMOTE.exec(target);
			if (remote === null) {
				return;
			}
			const [, action, ref] = remote;
			const occurrences = byAction.get(action) ?? [];
			occurrences.push({file: path, line: index + 1, ref, comment: uses[2] || undefined});
			byAction.set(action, occurrences);
		});
	}
	return [...byAction]
		.filter(([, occurrences]) => new Set(occurrences.map(({ref}) => ref)).size > 1)
		.map(([action, occurrences]) => ({action, occurrences}));
}

/** @param {ReturnType<typeof findPinConflicts>} conflicts */
export function formatConflicts(conflicts) {
	return conflicts
		.map(({action, occurrences}) => {
			const refCount = new Set(occurrences.map(({ref}) => ref)).size;
			const lines = occurrences.map(
				({file, line, ref, comment}) => `  ${file}:${line} ${ref}${comment ? ` # ${comment}` : ""}`,
			);
			return [`${action} is pinned to ${refCount} different refs:`, ...lines].join("\n");
		})
		.join("\n\n");
}

/**
 * @param {string} dir
 * @param {(name: string) => boolean} accept
 * @returns {string[]}
 */
function listFiles(dir, accept) {
	let entries;
	try {
		entries = readdirSync(dir, {withFileTypes: true, recursive: true});
	} catch (error) {
		if (error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
	return entries
		.filter((entry) => entry.isFile() && accept(entry.name))
		.map((entry) => join(entry.parentPath, entry.name))
		.toSorted();
}

function main() {
	const paths = [
		...listFiles(".github/workflows", (name) => /\.ya?ml$/u.test(name)),
		...listFiles(".github/actions", (name) => /^action\.ya?ml$/u.test(name)),
	];
	const files = paths.map((path) => ({path, content: readFileSync(path, "utf8")}));
	const conflicts = findPinConflicts(files);
	if (conflicts.length > 0) {
		console.error(formatConflicts(conflicts));
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
