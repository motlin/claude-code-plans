import type {PluginDetail} from "../../lib/api/customize";
import {countContentsFiles} from "./contents-order";

export type PluginTabId = "overview" | "contents" | "skills" | "connectors" | "agents" | "commands" | "hooks";

export interface PluginTab {
	id: PluginTabId;
	label: string;
	/** Shown as " · N"; null for Overview, which has no count. */
	count: number | null;
}

/**
 * Upstream Overview · Contents · N · Skills · N · Connectors · N, plus the
 * local-only Agents · N · Commands · N · Hooks · N. Every tab after Contents
 * is omitted when it would be empty.
 */
export function pluginDetailTabs(detail: PluginDetail): PluginTab[] {
	const {plugin} = detail;
	const counted: PluginTab[] = [
		{id: "skills", label: "Skills", count: plugin.skills.length},
		{id: "connectors", label: "Connectors", count: detail.connectors.length},
		{id: "agents", label: "Agents", count: plugin.agents.length},
		{id: "commands", label: "Commands", count: plugin.commands.length},
		{id: "hooks", label: "Hooks", count: detail.hooks.length},
	];
	return [
		{id: "overview", label: "Overview", count: null},
		{id: "contents", label: "Contents", count: countContentsFiles(detail.tree)},
		...counted.filter((tab) => (tab.count ?? 0) > 0),
	];
}

/** The `<plugin>` segment of `<plugin>@<marketplace>`, which namespaces its slash commands. */
export function pluginNamespace(pluginId: string): string {
	const at = pluginId.lastIndexOf("@");
	return at === -1 ? pluginId : pluginId.slice(0, at);
}

export function pluginInstallCommand(pluginId: string): string {
	return `claude plugin install ${pluginId}`;
}
