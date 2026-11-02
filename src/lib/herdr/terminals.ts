import {homedir} from "node:os";
import {z} from "zod";
import {getActiveSessionEntries} from "../active-session-store";
import {terminalWritesEnabled} from "../config";
import {rejectCrossSite} from "../same-origin-guard";
import {herdrRequest, type HerdrResult} from "./client";
import {qualifyHerdrId, splitHerdrId} from "./herdr-id";
import
{
	claudeSessionId,
	herdrPaneDisplayName,
	normalizePane,
	type HerdrAgentStatus,
	type HerdrRequester,
	type HerdrServerLister,
} from "./panes";
import
{
	HerdrPaneInfoResultSchema,
	HerdrPaneProcessInfoResultSchema,
	HerdrSessionSnapshotResultSchema,
	HerdrTabCreatedResultSchema,
} from "./schema";
import
{
	chooseHerdrLaunchServer,
	knownHerdrServers,
	qualifyHerdrPaneState,
	qualifyHerdrTabs,
	type HerdrServer,
} from "./servers";
import {workspaceLabel} from "./workspaces";

/**
 * herdr tabs and panes as a terminal manager sees them: every pane, whether it
 * runs Claude, another agent, or a plain shell. Unlike the workspace navigator
 * (`workspaces.ts`) this keeps herdr's tab grouping and asks each pane what it
 * is running, so a client can tell an idle shell from a busy one.
 */

/**
 * `idle`: the shell is at its prompt. `running`: a command holds the
 * foreground. `exited`: the pane's shell is gone. `unknown`: herdr could not
 * say.
 */
export type HerdrTerminalProcess = "idle" | "running" | "exited" | "unknown";

export interface HerdrTerminalPane
{
	paneId: string;
	terminalId: string;
	title: string;
	cwd: string | null;
	focused: boolean;
	agent: string | null;
	agentStatus: HerdrAgentStatus;
	/** The Claude transcript herdr resolved for the pane, indexed or not. */
	claudeSessionId: string | null;
	/** The foreground command line, the shell itself when idle. */
	command: string | null;
	process: HerdrTerminalProcess;
}

export interface HerdrTerminalTab
{
	tabId: string;
	number: number;
	label: string;
	focused: boolean;
	panes: HerdrTerminalPane[];
}

export interface HerdrTerminalWorkspace
{
	workspaceId: string;
	number: number;
	label: string;
	focused: boolean;
	tabs: HerdrTerminalTab[];
}

type HerdrSnapshot = z.infer<typeof HerdrSessionSnapshotResultSchema>["snapshot"];
type TerminalSnapshot = Pick<HerdrSnapshot, "workspaces" | "tabs" | "panes">;

const SNAPSHOT_REQUEST =
{
	id: "ccp:terminals:snap",
	method: "session.snapshot",
	params: {},
};

async function readServerSnapshot(request: HerdrRequester, server: HerdrServer): Promise<TerminalSnapshot | null>
{
	const response = await request(SNAPSHOT_REQUEST, undefined, server.socketPath);
	if (!response.ok) return null;
	const parsed = HerdrSessionSnapshotResultSchema.safeParse(response.value);
	if (!parsed.success) return null;
	const {workspaces, tabs, panes} = parsed.data.snapshot;
	const qualified = qualifyHerdrPaneState(
		{
			workspaces,
			panes,
		},
		server.session,
	);
	return {
		...qualified,
		tabs: qualifyHerdrTabs(tabs, server.session),
	};
}

async function readProcess(
	request: HerdrRequester,
	paneId: string,
): Promise<Pick<HerdrTerminalPane, "command" | "process">>
{
	const response = await request(
		{
			id: "ccp:terminals:process",
			method: "pane.process_info",
			params:
			{
				pane_id: paneId,
			},
		},
	);
	const parsed = response.ok ? HerdrPaneProcessInfoResultSchema.safeParse(response.value) : undefined;
	if (!parsed?.success)
		return {
			command: null,
			process: "unknown",
		};
	const info = parsed.data.process_info;
	const shellPid = info.shell_pid ?? null;
	if (shellPid === null)
		return {
			command: null,
			process: "exited",
		};
	const groupId = info.foreground_process_group_id ?? null;
	const processes = info.foreground_processes ?? [];
	const leader = processes.find((candidate) => candidate.pid === groupId) ?? processes[0];
	return {
		command: leader === undefined ? null : (leader.cmdline ?? leader.name),
		process: groupId !== null && groupId !== shellPid ? "running" : "idle",
	};
}

/**
 * Read every known herdr server's tabs and panes, with each pane's foreground
 * process. A server that fails contributes nothing, so with herdr absent the
 * list is empty.
 */
export async function getHerdrTerminals(
	request: HerdrRequester = herdrRequest,
	servers: HerdrServerLister = knownHerdrServers,
): Promise<HerdrTerminalWorkspace[]>
{
	const snapshots = await Promise.all(servers().map(async (server) => readServerSnapshot(request, server)));
	const workspaces: HerdrTerminalWorkspace[] = [];
	for (const snapshot of snapshots)
	{
		if (snapshot === null) continue;
		const panes = await Promise.all(
			snapshot.panes.map(
				async (
					wirePane,
				): Promise<
					HerdrTerminalPane &
					{
						tabId: string;
					}
				> =>
				{
					const pane = normalizePane(wirePane);
					return {
						tabId: pane.tabId,
						paneId: pane.paneId,
						terminalId: pane.terminalId,
						title: herdrPaneDisplayName(pane),
						cwd: pane.foregroundCwd ?? pane.cwd,
						focused: pane.focused,
						agent: pane.agent,
						agentStatus: pane.agentStatus,
						claudeSessionId: claudeSessionId(wirePane),
						...(await readProcess(request, pane.paneId)),
					};
				},
			),
		);
		const tabs = snapshot.tabs
			.map((tab) => (
			{
				workspaceId: tab.workspace_id,
				tab:
				{
					tabId: tab.tab_id,
					number: tab.number,
					label: tab.label,
					focused: tab.focused,
					panes: panes.filter((pane) => pane.tabId === tab.tab_id).map(({tabId: _tabId, ...pane}) => pane),
				},
			}))
			.toSorted((left, right) => left.tab.number - right.tab.number);
		const serverWorkspaces = snapshot.workspaces
			.map((workspace) => (
			{
				workspaceId: workspace.workspace_id,
				number: workspace.number,
				label: workspaceLabel(workspace.workspace_id, workspace.label),
				focused: workspace.focused,
				tabs: tabs.filter((entry) => entry.workspaceId === workspace.workspace_id).map((entry) => entry.tab),
			}))
			.toSorted((left, right) => left.number - right.number);
		workspaces.push(...serverWorkspaces);
	}
	return workspaces;
}

const AbsolutePathSchema = z.string().startsWith("/");
const CommandSchema = z.string().refine((command) => command.trim() !== "", "command cannot be blank");
const IdSchema = z.string().min(1);

const HerdrTerminalActionSchema = z.discriminatedUnion("action", [
	z
		.object(
			{
				action: z.literal("create-tab"),
				/** Absent: the home directory. */
				cwd: AbsolutePathSchema.optional(),
				/** Typed into the new shell; absent leaves the shell at its prompt. */
				command: CommandSchema.optional(),
				/** Absent: herdr's focused workspace on the launch server. */
				workspaceId: IdSchema.optional(),
				label: IdSchema.optional(),
			},
		)
		.strict(),
	z
		.object(
			{
				action: z.literal("split-pane"),
				paneId: IdSchema,
				direction: z.enum(["right", "down"]),
				cwd: AbsolutePathSchema.optional(),
				command: CommandSchema.optional(),
			},
		)
		.strict(),
	z
		.object(
			{
				action: z.literal("close-pane"),
				paneId: IdSchema,
			},
		)
		.strict(),
	z
		.object(
			{
				action: z.literal("close-tab"),
				tabId: IdSchema,
			},
		)
		.strict(),
	z
		.object(
			{
				action: z.literal("rename-tab"),
				tabId: IdSchema,
				label: IdSchema,
			},
		)
		.strict(),
	z
		.object(
			{
				action: z.literal("focus-pane"),
				paneId: IdSchema,
			},
		)
		.strict(),
	z
		.object(
			{
				action: z.literal("focus-tab"),
				tabId: IdSchema,
			},
		)
		.strict(),
]);

type HerdrTerminalAction = z.infer<typeof HerdrTerminalActionSchema>;

export interface HerdrTerminalActionDependencies
{
	rejectRequest: (request: Request) => Response | null;
	writesEnabled: () => boolean;
	request: HerdrRequester;
	createRequestId: () => string;
	homeDir: () => string;
	/** The herdr server a new tab opens on when no workspace is named (see `chooseHerdrLaunchServer`). */
	launchServer: () => HerdrServer;
}

const defaultHerdrTerminalActionDependencies: HerdrTerminalActionDependencies =
{
	rejectRequest: rejectCrossSite,
	writesEnabled: terminalWritesEnabled,
	request: herdrRequest,
	createRequestId: () => `ccp:terminal:${crypto.randomUUID()}`,
	homeDir: homedir,
	launchServer: () => chooseHerdrLaunchServer(getActiveSessionEntries(), knownHerdrServers()),
};

type ActionOutcome =
	|
	  {
			ok: true;
			value: Record<string, string>;
	  }
	|
	  {
			ok: false;
			code: string;
			message: string;
			created?: Record<string, string>;
	  };

function errorStatus(code: string): number
{
	if (code.endsWith("not_found")) return 404;
	return 502;
}

function failure(code: string, message: string): ActionOutcome
{
	return {
		ok: false,
		code,
		message,
	};
}

/** Type a command into a pane this request just created, then press Enter. */
async function typeCommand(
	paneId: string,
	command: string,
	{request, createRequestId}: HerdrTerminalActionDependencies,
): Promise<HerdrResult<unknown>>
{
	const typed = await request(
		{
			id: createRequestId(),
			method: "pane.send_text",
			params:
			{
				pane_id: paneId,
				text: command,
			},
		},
	);
	if (!typed.ok) return typed;
	return request(
		{
			id: createRequestId(),
			method: "pane.send_keys",
			params:
			{
				pane_id: paneId,
				keys: ["enter"],
			},
		},
	);
}

async function finishWithCommand(
	created: Record<string, string>,
	paneId: string,
	command: string | undefined,
	dependencies: HerdrTerminalActionDependencies,
): Promise<ActionOutcome>
{
	if (command === undefined)
		return {
			ok: true,
			value: created,
		};
	const typed = await typeCommand(paneId, command, dependencies);
	// The pane stays open either way, so the client can still open it.
	return typed.ok
		?
			{
				ok: true,
				value: created,
			}
		:
			{
				...typed,
				created,
			};
}

async function createTab(
	{
		cwd,
		command,
		workspaceId,
		label,
	}: Extract<
		HerdrTerminalAction,
		{
			action: "create-tab";
		}
	>,
	dependencies: HerdrTerminalActionDependencies,
): Promise<ActionOutcome>
{
	const {request, createRequestId} = dependencies;
	// A named workspace routes the request (and qualifies the new ids) by its own server.
	const server = workspaceId === undefined ? dependencies.launchServer() : null;
	const session = server === null ? splitHerdrId(workspaceId ?? "").session : server.session;
	const response = await request(
		{
			id: createRequestId(),
			method: "tab.create",
			params:
			{
				cwd: cwd ?? dependencies.homeDir(),
				focus: false,
				...(workspaceId === undefined
					? {}
					:
						{
							workspace_id: workspaceId,
						}),
				...(label === undefined
					? {}
					:
						{
							label,
						}),
			},
		},
		undefined,
		server?.socketPath,
	);
	if (!response.ok) return response;
	const created = HerdrTabCreatedResultSchema.safeParse(response.value);
	if (!created.success) return failure("bad-response", "herdr returned an invalid tab.create result");
	const tabId = qualifyHerdrId(created.data.tab.tab_id, session);
	const paneId = qualifyHerdrId(created.data.root_pane.pane_id, session);
	return finishWithCommand(
		{
			tabId,
			paneId,
		},
		paneId,
		command,
		dependencies,
	);
}

async function splitPane(
	{
		paneId,
		direction,
		cwd,
		command,
	}: Extract<
		HerdrTerminalAction,
		{
			action: "split-pane";
		}
	>,
	dependencies: HerdrTerminalActionDependencies,
): Promise<ActionOutcome>
{
	const response = await dependencies.request(
		{
			id: dependencies.createRequestId(),
			method: "pane.split",
			params:
			{
				target_pane_id: paneId,
				direction,
				focus: false,
				...(cwd === undefined
					? {}
					:
						{
							cwd,
						}),
			},
		},
	);
	if (!response.ok) return response;
	const split = HerdrPaneInfoResultSchema.safeParse(response.value);
	if (!split.success) return failure("bad-response", "herdr returned an invalid pane.split result");
	const newPaneId = qualifyHerdrId(split.data.pane.pane_id, splitHerdrId(paneId).session);
	return finishWithCommand(
		{
			paneId: newPaneId,
		},
		newPaneId,
		command,
		dependencies,
	);
}

function forwardedRequest(action: HerdrTerminalAction):
{
	method: string;
	params: Record<string, string>;
} | null
{
	switch (action.action)
	{
		case "close-pane":
			return {
				method: "pane.close",
				params:
				{
					pane_id: action.paneId,
				},
			};
		case "close-tab":
			return {
				method: "tab.close",
				params:
				{
					tab_id: action.tabId,
				},
			};
		case "rename-tab":
			return {
				method: "tab.rename",
				params:
				{
					tab_id: action.tabId,
					label: action.label,
				},
			};
		case "focus-pane":
			return {
				method: "pane.focus",
				params:
				{
					pane_id: action.paneId,
				},
			};
		case "focus-tab":
			return {
				method: "tab.focus",
				params:
				{
					tab_id: action.tabId,
				},
			};
		default:
			return null;
	}
}

async function runAction(
	action: HerdrTerminalAction,
	dependencies: HerdrTerminalActionDependencies,
): Promise<ActionOutcome>
{
	if (action.action === "create-tab") return createTab(action, dependencies);
	if (action.action === "split-pane") return splitPane(action, dependencies);
	const forwarded = forwardedRequest(action);
	if (forwarded === null) return failure("invalid-request", "unknown terminal action");
	const response = await dependencies.request(
		{
			id: dependencies.createRequestId(),
			...forwarded,
		},
	);
	return response.ok
		?
			{
				ok: true,
				value: {},
			}
		: response;
}

/**
 * Manage herdr tabs and panes: create a tab or split a pane running the login
 * shell (or a given command), close, rename, and focus. Same request handling
 * as the other herdr writes: same-origin, then the Live terminal input setting.
 */
export async function handleHerdrTerminalAction(
	request: Request,
	dependencies: HerdrTerminalActionDependencies = defaultHerdrTerminalActionDependencies,
): Promise<Response>
{
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	if (!dependencies.writesEnabled())
	{
		return Response.json(
			{
				error: "herdr writes are disabled",
			},
			{
				status: 403,
			},
		);
	}

	const json: unknown = await request.json();
	const parsed = HerdrTerminalActionSchema.safeParse(json);
	if (!parsed.success)
	{
		return Response.json(
			{
				error: z.prettifyError(parsed.error),
			},
			{
				status: 400,
			},
		);
	}

	const outcome = await runAction(parsed.data, dependencies);
	if (!outcome.ok)
	{
		return Response.json(
			{
				error: outcome.message,
				code: outcome.code,
				...outcome.created,
			},
			{
				status: errorStatus(outcome.code),
			},
		);
	}
	return Response.json(
		{
			ok: true,
			...outcome.value,
		},
	);
}
