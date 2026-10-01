import {useQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {Blocks, BriefcaseBusiness, CloudOff, LibraryBig} from "lucide-react";

import {customizeMcpServersQueryOptions, type McpServerSummary} from "../lib/api/customize";
import {toConnectorSlug} from "../lib/customize/mcp-tool-permissions";
import {MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger} from "./ui/menu";

/*
 * The claude.ai/code composer + menu's Connectors submenu, backed by the local
 * MCP config: Browse / Manage open Customize > Connectors, and each server row
 * opens its detail page. A running CLI cannot toggle servers live, so the
 * switches only show whether each server is enabled.
 */

/** Upstream's 25x14 menu switch, display-only. */
function ReadOnlySwitch({checked, name}: {checked: boolean; name: string}) {
	return (
		<span
			role="switch"
			aria-checked={checked}
			aria-readonly="true"
			aria-label={`${name} enabled`}
			data-checked={checked ? "" : undefined}
			className="relative ml-auto inline-flex h-[14px] w-[25px] shrink-0 rounded-full bg-[var(--settings-switch-track)] p-[2px] data-[checked]:bg-accent-100"
		>
			<span
				aria-hidden="true"
				className={`block size-[10px] rounded-full bg-white shadow-sm ${checked ? "translate-x-[11px]" : "translate-x-0"}`}
			/>
		</span>
	);
}

function reconnectionNote(servers: readonly McpServerSummary[]): string | undefined {
	const count = servers.filter((server) => server.needsAuth).length;
	return count === 0 ? undefined : `${count} ${count === 1 ? "needs" : "need"} reconnection`;
}

export function ComposerConnectorsMenu() {
	const navigate = useNavigate();
	const {data: servers = []} = useQuery(customizeMcpServersQueryOptions);
	const note = reconnectionNote(servers);
	const openConnectors = () => void navigate({to: "/customize/connectors"});
	const openServer = (server: McpServerSummary) =>
		void navigate({to: "/customize/connectors/id/$serverId", params: {serverId: toConnectorSlug(server.id)}});

	return (
		<MenuSub>
			<MenuSubTrigger icon={<Blocks />} {...(note === undefined ? {} : {value: note})}>
				Connectors
			</MenuSubTrigger>
			<MenuSubContent>
				<MenuItem icon={<LibraryBig />} onSelect={openConnectors}>
					Browse connectors
				</MenuItem>
				<MenuItem icon={<BriefcaseBusiness />} onSelect={openConnectors}>
					Manage connectors
				</MenuItem>
				{servers.length > 0 && <MenuSeparator />}
				{servers.map((server) =>
					server.needsAuth ? (
						<MenuItem
							key={server.id}
							icon={<CloudOff />}
							description="Reconnect"
							onSelect={() => openServer(server)}
						>
							{server.name}
						</MenuItem>
					) : (
						<MenuItem
							key={server.id}
							aria-label={server.name}
							icon={<Blocks />}
							onSelect={() => openServer(server)}
						>
							<span className="flex items-center gap-3">
								<span className="min-w-0 flex-1 truncate">{server.name}</span>
								<ReadOnlySwitch checked={server.enabled} name={server.name} />
							</span>
						</MenuItem>
					),
				)}
			</MenuSubContent>
		</MenuSub>
	);
}
