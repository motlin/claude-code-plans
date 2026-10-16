import {z} from "zod";

/**
 * Terminal-placement field mirroring the `TmuxWindow` interface produced by
 * `getTmuxWindows` (`../tmux-windows`) — see there for how the fields map to
 * tmux. `.strict()` so any drift from that interface fails loudly at parse time.
 */
export const TmuxWindowSchema = z
	.object({
		sessionId: z.string(),
		projectName: z.string(),
		windowIndex: z.number(),
		windowName: z.string(),
		windowActive: z.boolean(),
		tmuxPane: z.string(),
		socket: z.string(),
	})
	.strict();
