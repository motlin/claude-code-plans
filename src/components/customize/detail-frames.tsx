import {useQuery} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {
	customizeMcpServerDetailQueryOptions,
	customizePluginDetailQueryOptions,
	customizeSkillDetailQueryOptions,
	type PluginDetail,
	type SkillDetail,
} from "../../lib/api/customize";
import {ConnectorDetailHeader, ToolPermissions} from "./connector-detail";
import {CustomizeNotice} from "./customize-empty";
import {PluginDetailHeader} from "./plugin-detail";
import {SkillDetailHeader} from "./skill-detail";

/** Skill detail: loading and not-found states, else the header over `children(detail)`. */
export function SkillDetailFrame({skillId, children}: {skillId: string; children: (detail: SkillDetail) => ReactNode}) {
	const {data, isPending, isError} = useQuery(customizeSkillDetailQueryOptions(skillId));
	if (isPending) return <p className="text-body text-t6">Loading skill…</p>;
	if (isError) {
		return (
			<CustomizeNotice
				title="Skill not found"
				body="It may have been removed or renamed since the list was loaded."
			/>
		);
	}
	return (
		<div className="flex flex-col gap-6">
			<SkillDetailHeader detail={data} />
			{children(data)}
		</div>
	);
}

/** Plugin detail: loading and not-found states, else the header over `children(detail)`. */
export function PluginDetailFrame({
	pluginId,
	children,
}: {
	pluginId: string;
	children: (detail: PluginDetail) => ReactNode;
}) {
	const {data, isPending, isError} = useQuery(customizePluginDetailQueryOptions(pluginId));
	if (isPending) return <p className="text-body text-t6">Loading plugin…</p>;
	if (isError) {
		return (
			<CustomizeNotice title="Plugin not found" body="It may have been uninstalled since the list was loaded." />
		);
	}
	return (
		<div className="flex flex-col gap-6">
			<PluginDetailHeader detail={data} />
			{children(data)}
		</div>
	);
}

/** Connector detail for a `toConnectorSlug` id: header, copyable URL or command, and tool permissions. */
export function ConnectorDetailFrame({serverId}: {serverId: string}) {
	const query = customizeMcpServerDetailQueryOptions(serverId);
	const {data, isPending, isError} = useQuery(query);
	if (isPending) return <p className="text-body text-t6">Loading connector…</p>;
	if (isError) {
		return (
			<CustomizeNotice
				title="Connector not found"
				body="It may have been removed or renamed since the list was loaded."
			/>
		);
	}
	return (
		<div className="flex flex-col">
			<ConnectorDetailHeader detail={data} />
			<ToolPermissions detail={data} detailQueryKey={query.queryKey} />
		</div>
	);
}
