import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

const LocalUserResponse = z.object({ username: z.string().min(1).nullable() }).strict();

export const localUserQueryOptions = queryOptions({
  queryKey: ["local-user"] as const,
  queryFn: () => apiFetch("/api/local-user", LocalUserResponse),
  staleTime: Infinity,
});
