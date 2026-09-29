import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { SLASH_COMMAND_SOURCES, type SlashCommand } from "../slash-commands";
import { apiFetch } from "./client";

const SlashCommandSchema: z.ZodType<SlashCommand> = z.strictObject({
  name: z.string().min(1),
  description: z.string(),
  source: z.enum(SLASH_COMMAND_SOURCES),
  argumentHint: z.string().optional(),
});

export const SlashCommandListResponse = z.array(SlashCommandSchema);

export function slashCommandsQueryOptions(cwd: string | undefined) {
  const url = cwd === undefined ? "/api/commands" : `/api/commands?cwd=${encodeURIComponent(cwd)}`;
  return queryOptions({
    queryKey: ["slash-commands", cwd ?? null],
    queryFn: () => apiFetch(url, SlashCommandListResponse),
    staleTime: 30_000,
  });
}
