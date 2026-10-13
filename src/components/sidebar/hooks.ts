import {fromMdSlug} from "../../lib/md-slug";
import type {Section} from "./types";

/** The parts of a router match this reads; `useMatches()` results satisfy it. */
interface ActiveMatch {
	fullPath: string;
	params: Partial<Record<string, string>>;
}

export function activeSectionFor(matches: readonly ActiveMatch[]): {
	section: Section | null;
	activeItemId: string | null;
} {
	const lastMatch = matches.at(-1);
	const path = lastMatch?.fullPath ?? "/";
	const params = lastMatch?.params;

	if (path.startsWith("/artifacts")) {
		return {section: "artifacts", activeItemId: null};
	}
	if (path.startsWith("/routines")) {
		return {section: "routines", activeItemId: null};
	}
	if (path.startsWith("/jobs")) {
		return {section: "jobs", activeItemId: null};
	}
	if (path.startsWith("/active")) {
		return {section: "active", activeItemId: null};
	}
	if (path.startsWith("/herdr")) {
		return {section: "herdr", activeItemId: params?.["sessionId"] ?? null};
	}
	if (path.startsWith("/tmux")) {
		return {section: "tmux", activeItemId: null};
	}
	if (path.startsWith("/approvals")) {
		return {section: "approvals", activeItemId: null};
	}
	if (path.startsWith("/notifications")) {
		return {section: "notifications", activeItemId: null};
	}
	if (path.startsWith("/tasks")) {
		return {section: "tasks", activeItemId: null};
	}
	if (path.startsWith("/project") && !path.startsWith("/projects")) {
		return {section: "projects", activeItemId: params?.["id"] ?? null};
	}
	if (path === "/projects") {
		return {section: "projects", activeItemId: null};
	}
	if (path.startsWith("/plan") || path === "/plans") {
		return {
			section: "plans",
			activeItemId: params?.["filename"] ? fromMdSlug(params["filename"]) : null,
		};
	}
	if (path.startsWith("/memor") || path === "/memories") {
		return {
			section: "memories",
			activeItemId:
				params?.["project"] && params["filename"]
					? `${params["project"]}/${fromMdSlug(params["filename"])}`
					: null,
		};
	}
	if (path.startsWith("/session") || path === "/sessions") {
		return {section: "sessions", activeItemId: params?.["id"] ?? null};
	}
	if (path.startsWith("/customize") || path.startsWith("/plugin") || path.startsWith("/command")) {
		return {section: "customize", activeItemId: null};
	}
	return {section: null, activeItemId: null};
}
