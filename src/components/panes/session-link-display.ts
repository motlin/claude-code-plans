import {useEffect, useMemo, useState, type ComponentType, type ReactNode} from "react";

import {
	extractSessionLinks,
	groupSessionLinks,
	type CollectedLink,
	type LinkGroup,
	type SessionLinks,
} from "../../lib/session-links";
import type {SessionLine} from "../../lib/transcript";

export interface LinkEnricher {
	extractId(url: string): string | null;
	Wrapper: ComponentType<{id: string; children: ReactNode}>;
}

export const LINK_ENRICHERS: Readonly<Record<string, LinkEnricher>> = {};

export const INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY = "ccp-session-links-include-tools-and-thinking";

export interface SessionLinkDisplay {
	groups: LinkGroup[];
	totalCount: number;
	hiddenCount: number;
}

/** The pane's Include tools and thinking checkbox, remembered across sessions. */
export function useIncludeToolsAndThinking(): [boolean, (include: boolean) => void] {
	const [include, setInclude] = useState(false);
	const [storageHydrated, setStorageHydrated] = useState(false);

	useEffect(() => {
		setInclude(localStorage.getItem(INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY) === "true");
		setStorageHydrated(true);
	}, []);

	useEffect(() => {
		if (!storageHydrated) return;
		localStorage.setItem(INCLUDE_TOOLS_AND_THINKING_STORAGE_KEY, String(include));
	}, [include, storageHydrated]);

	return [include, setInclude];
}

export function useExtractedSessionLinks(
	lines: SessionLine[],
	currentHost: string | undefined,
	userRules: Array<{label: string; hostPattern: string}>,
): SessionLinks {
	return useMemo(() => extractSessionLinks(lines, currentHost, userRules), [currentHost, lines, userRules]);
}

/**
 * Group links the server already collected over the whole session. Returns
 * undefined until that scan lands, which is the caller's signal to keep showing
 * the window-only extraction and its `12+` floors.
 */
export function useGroupedSessionLinks(
	links: CollectedLink[] | undefined,
	currentHost: string | undefined,
	userRules: Array<{label: string; hostPattern: string}>,
): SessionLinks | undefined {
	return useMemo(
		() => (links === undefined ? undefined : groupSessionLinks(links, currentHost, userRules)),
		[currentHost, links, userRules],
	);
}

function visibleMessageGroups(groups: LinkGroup[]): LinkGroup[] {
	return groups.flatMap((group) => {
		const entries = group.entries.flatMap((entry) => {
			const occurrences = entry.occurrences.filter((occurrence) => occurrence.source === "visible");
			return occurrences.length === 0 ? [] : [{...entry, occurrences}];
		});
		return entries.length === 0 ? [] : [{...group, entries}];
	});
}

function countEntries(groups: LinkGroup[]): number {
	return groups.reduce((count, group) => count + group.entries.length, 0);
}

export function useSessionLinkDisplay(
	sessionLinks: SessionLinks,
	includeToolsAndThinking: boolean,
): SessionLinkDisplay {
	const visibleGroups = useMemo(() => visibleMessageGroups(sessionLinks.groups), [sessionLinks.groups]);
	const visibleCount = useMemo(() => countEntries(visibleGroups), [visibleGroups]);

	return useMemo(
		() => ({
			groups: includeToolsAndThinking ? sessionLinks.groups : visibleGroups,
			totalCount: includeToolsAndThinking ? sessionLinks.totalCount : visibleCount,
			hiddenCount: sessionLinks.totalCount - visibleCount,
		}),
		[includeToolsAndThinking, sessionLinks.groups, sessionLinks.totalCount, visibleCount, visibleGroups],
	);
}
