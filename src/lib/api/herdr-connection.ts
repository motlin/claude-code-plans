import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/** Mirrors `herdrReconnectState` (`../herdr/reconnect-state`): whether the herdr subscription is resubscribing. */
export const HerdrConnectionResponse = z.strictObject({reconnecting: z.boolean()});

export const herdrConnectionQueryOptions = queryOptions({
	queryKey: ["herdr", "connection"] as const,
	queryFn: async () => apiFetch("/api/herdr-connection", HerdrConnectionResponse),
});
