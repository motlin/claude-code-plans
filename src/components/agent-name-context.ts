import {createContext} from "react";

/** Resolves a bare agent id to the subagent's description, or null when the session does not know it. */
export type AgentNameResolver = (agentId: string) => string | null;

export const AgentNameContext = createContext<AgentNameResolver>(() => null);
