import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";
import { HerdrPaneSchema } from "./herdr";
import { TmuxWindowSchema } from "./tmux";

const TerminalPlacementCapabilitiesSchema = z
  .object({
    supportsWrite: z.boolean(),
    supportsEvents: z.boolean(),
    supportsObserve: z.boolean(),
  })
  .strict();

const TerminalPlacementFields = {
  sessionId: z.string(),
  displayName: z.string(),
  active: z.boolean(),
  paneHandle: z.string(),
  scopeHandle: z.string(),
  capabilities: TerminalPlacementCapabilitiesSchema,
};

const TmuxTerminalPlacementSchema = z
  .object({
    provider: z.literal("tmux"),
    ...TerminalPlacementFields,
    tmuxWindow: TmuxWindowSchema,
  })
  .strict();

const HerdrTerminalPlacementSchema = z
  .object({
    provider: z.literal("herdr"),
    ...TerminalPlacementFields,
    herdrPane: HerdrPaneSchema,
  })
  .strict();

export const TerminalPlacementIndexResponse = z
  .object({
    placements: z.array(
      z.discriminatedUnion("provider", [TmuxTerminalPlacementSchema, HerdrTerminalPlacementSchema]),
    ),
    writesEnabled: z.boolean(),
  })
  .strict();

export const terminalPlacementsQueryOptions = queryOptions({
  queryKey: ["terminal", "placements"] as const,
  queryFn: () => apiFetch("/api/terminal-placements", TerminalPlacementIndexResponse),
});
