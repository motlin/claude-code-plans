import {linkOptions, useNavigate} from "@tanstack/react-router";
import {createContext, useContext} from "react";
import type {PluginTabId} from "./plugin-view";
import type {CustomizeSearch, CustomizeSectionId} from "./sections";
import {assertNever} from "../../lib/assert-never";
import {toMdSlug} from "../../lib/md-slug";

/** A place inside Customize: a section list, or a skill, plugin, connector or custom command detail. */
export type CustomizeTarget =
	| {kind: "list"; section: CustomizeSectionId; search?: CustomizeSearch}
	| {kind: "skill"; id: string; tab: "overview" | "contents"}
	| {kind: "plugin"; id: string; tab: PluginTabId; file?: string}
	| {kind: "connector"; slug: string}
	/** A custom (legacy) command, by source (`global` or a project id) and on-disk `.md` filename. */
	| {kind: "command"; source: string; filename: string};

/**
 * How Customize links move. Without a provider they go to the /customize
 * routes; the Settings dialog provides one that rewrites the location hash.
 */
export interface CustomizeNavigator {
	href: (target: CustomizeTarget) => string;
	isCurrent: (target: CustomizeTarget) => boolean;
	go: (target: CustomizeTarget) => void;
	/** Set while the open detail was reached from a unified search hit: its back link reads "Search". */
	searchReturn?: CustomizeSearchReturn | null;
}

/** Upstream's `setCustomizeSearchReturn`: where the detail's "Search" back link leads. */
export interface CustomizeSearchReturn {
	href: string;
	go: () => void;
}

export const CustomizeNavContext = createContext<CustomizeNavigator | null>(null);

const PLUGIN_TAB_ROUTES = {
	overview: "/customize/plugins/id/$pluginId",
	skills: "/customize/plugins/id/$pluginId/skills",
	connectors: "/customize/plugins/id/$pluginId/connectors",
	agents: "/customize/plugins/id/$pluginId/agents",
	commands: "/customize/plugins/id/$pluginId/commands",
	hooks: "/customize/plugins/id/$pluginId/hooks",
} as const satisfies Record<Exclude<PluginTabId, "contents">, string>;

export function routeOptions(target: CustomizeTarget) {
	switch (target.kind) {
		case "list":
			return linkOptions({
				to: `/customize/${target.section}`,
				search: target.search ?? {},
			});
		case "skill":
			return target.tab === "overview"
				? linkOptions({to: "/customize/skills/id/$skillId", params: {skillId: target.id}})
				: linkOptions({to: "/customize/skills/id/$skillId/contents", params: {skillId: target.id}});
		case "plugin":
			return target.tab === "contents"
				? linkOptions({
						to: "/customize/plugins/id/$pluginId/contents",
						params: {pluginId: target.id},
						search: target.file === undefined ? {} : {file: target.file},
					})
				: linkOptions({to: PLUGIN_TAB_ROUTES[target.tab], params: {pluginId: target.id}});
		case "connector":
			return linkOptions({to: "/customize/connectors/id/$serverId", params: {serverId: target.slug}});
		case "command":
			return linkOptions({
				to: "/customize/skills/command/$source/$filename",
				params: {source: target.source, filename: toMdSlug(target.filename)},
			});
		default:
			return assertNever(target);
	}
}

/** Navigate to a Customize target through the surrounding navigator, or the /customize routes by default. */
export function useCustomizeGo(): (target: CustomizeTarget) => void {
	const navigator = useContext(CustomizeNavContext);
	const navigate = useNavigate();
	if (navigator !== null) return navigator.go;
	return (target) => void navigate(routeOptions(target));
}
