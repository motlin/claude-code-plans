import { z } from "zod";

/**
 * Response shape mirroring the `TmuxWindow` interface produced by
 * `getTmuxWindows` (`../tmux-windows`) — see there for how the fields map to
 * tmux. `.strict()` so any drift from that interface fails loudly at parse time.
 */
const TmuxWindowSchema = z
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

export const TmuxWindowListResponse = z.array(TmuxWindowSchema);
