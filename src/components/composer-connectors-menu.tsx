import {useQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {Blocks, CloudOff, LibraryBig, Wrench} from "lucide-react";

import {customizeMcpServersQueryOptions, type McpServerSummary} from "../lib/api/customize";
import {toConnectorSlug} from "../lib/customize/mcp-tool-permissions";
import {ConnectorsLoadingItem} from "./composer-connectors-loading";
import {MenuCheckboxSwitchItem, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger} from "./ui/menu";

/*
 * The claude.ai/code composer + menu's Connectors submenu, backed by the local
 * MCP config: Browse / Manage open Customize > Connectors, and each server row
 * opens its detail page. Connected servers come first, then the ones that need
 * reconnection, as upstream orders them. A running CLI cannot toggle servers
 * live, so the switches only show whether each server is enabled. While the config loads the row is a
 * disabled spinner, and with no servers it is a plain "Add connectors" item.
 */

function reconnectionNote(servers: readonly McpServerSummary[]): string | undefined {
	const count = servers.filter((server) => server.needsAuth).length;
	return count === 0 ? undefined : `${count} ${count === 1 ? "needs" : "need"} reconnection`;
}

export function ComposerConnectorsMenu() {
	const navigate = useNavigate();
	const {data: servers = [], isPending} = useQuery(customizeMcpServersQueryOptions);
	const note = reconnectionNote(servers);
	const connected = servers.filter((server) => !server.needsAuth);
	const reconnect = servers.filter((server) => server.needsAuth);
	const openConnectors = () => void navigate({to: "/customize/connectors"});
	const openServer = (server: McpServerSummary) =>
		void navigate({to: "/customize/connectors/id/$serverId", params: {serverId: toConnectorSlug(server.id)}});

	if (isPending) return <ConnectorsLoadingItem />;
	if (servers.length === 0) {
		return (
			<MenuItem icon={<Blocks />} onSelect={openConnectors}>
				Add connectors
			</MenuItem>
		);
	}
	return (
		<MenuSub>
			<MenuSubTrigger icon={<Blocks />} {...(note === undefined ? {} : {value: note})}>
				Connectors
			</MenuSubTrigger>
			<MenuSubContent>
				<MenuItem icon={<LibraryBig />} onSelect={openConnectors}>
					Browse connectors
				</MenuItem>
				<MenuItem icon={<Wrench />} onSelect={openConnectors}>
					Manage connectors
				</MenuItem>
				<MenuSeparator />
				{connected.map((server) => (
					<MenuCheckboxSwitchItem
						key={server.id}
						aria-label={server.name}
						icon={<Blocks />}
						checked={server.enabled}
						closeOnClick
						onCheckedChange={() => {
							openServer(server);
						}}
					>
						{server.name}
					</MenuCheckboxSwitchItem>
				))}
				{reconnect.map((server) => (
					<MenuItem
						key={server.id}
						icon={<CloudOff />}
						description="Reconnect"
						onSelect={() => {
							openServer(server);
						}}
					>
						{server.name}
					</MenuItem>
				))}
			</MenuSubContent>
		</MenuSub>
	);
}
