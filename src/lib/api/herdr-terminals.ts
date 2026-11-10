import {z} from "zod";

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
