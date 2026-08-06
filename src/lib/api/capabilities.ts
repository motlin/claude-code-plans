import { queryOptions } from "@tanstack/react-query";
import { CapabilitiesSchema, type PersistedCapabilities } from "../capabilities";
import { apiFetch } from "./client";

export function capabilitiesQueryOptions(capabilities: PersistedCapabilities) {
  return queryOptions({
    queryKey: ["capabilities", capabilities] as const,
    queryFn: () =>
      apiFetch("/api/capabilities", CapabilitiesSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(capabilities),
      }),
    staleTime: 10_000,
  });
}
