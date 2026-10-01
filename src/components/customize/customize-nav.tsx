import {Link, linkOptions, useNavigate} from "@tanstack/react-router";
import {createContext, type MouseEvent, type ReactNode, useContext} from "react";
import type {PluginTabId} from "./plugin-view";
import type {CustomizeSearch, CustomizeSectionId} from "./sections";

/** A place inside Customize: a section list, or a skill, plugin or connector detail tab. */
export type CustomizeTarget =
	| {kind: "list"; section: CustomizeSectionId; search?: CustomizeSearch}
	| {kind: "skill"; id: string; tab: "overview" | "contents"}
	| {kind: "plugin"; id: string; tab: PluginTabId; file?: string}
	| {kind: "connector"; slug: string};

/**
 * How Customize links move. Without a provider they go to the /customize
 * routes; the Settings dialog provides one that rewrites the location hash.
 */
export interface CustomizeNavigator {
	href: (target: CustomizeTarget) => string;
	isCurrent: (target: CustomizeTarget) => boolean;
	go: (target: CustomizeTarget) => void;
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

function routeOptions(target: CustomizeTarget) {
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
	}
}

/** Navigate to a Customize target through the surrounding navigator, or the /customize routes by default. */
export function useCustomizeGo(): (target: CustomizeTarget) => void {
	const navigator = useContext(CustomizeNavContext);
	const navigate = useNavigate();
	if (navigator !== null) return navigator.go;
	return (target) => void navigate(routeOptions(target));
}

interface CustomizeLinkProps {
	target: CustomizeTarget;
	className: string;
	children: ReactNode;
}

/** A link to a Customize target that marks itself `aria-current="page"` when it is the open place. */
export function CustomizeLink({target, className, children}: CustomizeLinkProps) {
	const navigator = useContext(CustomizeNavContext);
	if (navigator === null) {
		return (
			<Link {...routeOptions(target)} activeOptions={{exact: true, includeSearch: false}} className={className}>
				{children}
			</Link>
		);
	}
	const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
		event.preventDefault();
		navigator.go(target);
	};
	return (
		<a
			href={navigator.href(target)}
			aria-current={navigator.isCurrent(target) ? "page" : undefined}
			onClick={onClick}
			className={className}
		>
			{children}
		</a>
	);
}
