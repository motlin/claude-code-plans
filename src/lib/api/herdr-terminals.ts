import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/**
 * Response shapes mirroring the `HerdrTerminalWorkspace` read model produced by
 * `getHerdrTerminals` (`../herdr/terminals`). Strict, like the other ccp-owned
 * API boundaries, so drift between the producer and the browser fails loudly.
 */
const HerdrTerminalPaneSchema = z
	.object({
		paneId: z.string(),
		terminalId: z.string(),
		title: z.string(),
		cwd: z.string().nullable(),
		focused: z.boolean(),
		agent: z.string().nullable(),
		agentStatus: z.string(),
		claudeSessionId: z.string().nullable(),
		command: z.string().nullable(),
		process: z.enum(["idle", "running", "exited", "unknown"]),
	})
	.strict();

const HerdrTerminalTabSchema = z
	.object({
		tabId: z.string(),
		number: z.number(),
		label: z.string(),
		focused: z.boolean(),
		panes: z.array(HerdrTerminalPaneSchema),
	})
	.strict();

const HerdrTerminalWorkspaceSchema = z
	.object({
		workspaceId: z.string(),
		number: z.number(),
		label: z.string(),
		focused: z.boolean(),
		tabs: z.array(HerdrTerminalTabSchema),
	})
	.strict();

export const HerdrTerminalIndexResponse = z.object({workspaces: z.array(HerdrTerminalWorkspaceSchema)}).strict();

export type HerdrTerminalPaneData = z.infer<typeof HerdrTerminalPaneSchema>;
export type HerdrTerminalWorkspaceData = z.infer<typeof HerdrTerminalWorkspaceSchema>;

/** Every herdr tab and pane, Claude or not; the herdr pane and tab events invalidate it. */
export const herdrTerminalsQueryOptions = queryOptions({
	queryKey: ["herdr", "terminals"] as const,
	queryFn: async () => apiFetch("/api/herdr/terminals", HerdrTerminalIndexResponse),
});

const CreatedTerminalResponse = z.object({ok: z.literal(true), tabId: z.string(), paneId: z.string()}).strict();
const TerminalActionErrorResponse = z.object({error: z.string()}).loose();

/** Open a new herdr tab running the login shell in `cwd` (the home directory when absent); resolves to its pane id. */
export async function createHerdrTerminal(cwd: string | null): Promise<string> {
	const response = await fetch("/api/herdr/terminals", {
		method: "POST",
		credentials: "same-origin",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({action: "create-tab", ...(cwd === null ? {} : {cwd})}),
	});
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const failure = TerminalActionErrorResponse.safeParse(body);
		throw new Error(failure.success ? failure.data.error : "Failed to open a terminal");
	}
	return CreatedTerminalResponse.parse(body).paneId;
}
