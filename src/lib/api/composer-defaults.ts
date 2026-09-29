import { queryOptions } from "@tanstack/react-query";
import { ComposerDefaultsResponse } from "../composer-state";
import { apiFetch } from "./client";

export const composerDefaultsQueryOptions = queryOptions({
  queryKey: ["composer-defaults"] as const,
  queryFn: () => apiFetch("/api/composer-defaults", ComposerDefaultsResponse),
});
