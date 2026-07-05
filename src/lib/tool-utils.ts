/**
 * Extract agent type from tool input, preferring agentType over subagent_type.
 * Returns the agent type string or empty string if not found.
 */
export function getAgentTypeFromInput(input: Record<string, unknown>): string {
  return (input["agentType"] as string) ?? (input["subagent_type"] as string) ?? "";
}

/**
 * Extract agent type from tool input with a fallback default.
 * Returns the agent type string or the provided default.
 */
export function getAgentTypeWithDefault(
  input: Record<string, unknown>,
  defaultType: string = "general-purpose",
): string {
  return (input["agentType"] as string) ?? (input["subagent_type"] as string) ?? defaultType;
}

/**
 * Extract agent type from tool input, returning null if not found.
 * Used in cases where null is a valid state (e.g., in database records).
 */
export function getAgentTypeOrNull(input: Record<string, unknown>): string | null {
  const type = (input["agentType"] as string) ?? (input["subagent_type"] as string);
  return type ?? null;
}
