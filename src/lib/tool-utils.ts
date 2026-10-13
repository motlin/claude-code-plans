/**
 * Read the first of `keys` that holds a string in an unvalidated tool input.
 * Missing and non-string values fall through to the next key, then to undefined.
 */
export function inputString(input: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string") return value;
	}
	return undefined;
}

/**
 * Extract agent type from tool input, preferring agentType over subagent_type.
 * Returns the agent type string or empty string if not found.
 */
export function getAgentTypeFromInput(input: Record<string, unknown>): string {
	return inputString(input, "agentType", "subagent_type") ?? "";
}

/**
 * Extract agent type from tool input with a fallback default.
 * Returns the agent type string or the provided default.
 */
export function getAgentTypeWithDefault(
	input: Record<string, unknown>,
	defaultType: string = "general-purpose",
): string {
	return inputString(input, "agentType", "subagent_type") ?? defaultType;
}

/**
 * Extract agent type from tool input, returning null if not found.
 * Used in cases where null is a valid state (e.g., in database records).
 */
export function getAgentTypeOrNull(input: Record<string, unknown>): string | null {
	return inputString(input, "agentType", "subagent_type") ?? null;
}

/**
 * Resolve the label Claude supplies for a TaskCreate call. Recent records may
 * omit subject, so use the descriptive fields in their order of specificity.
 */
export function getTaskCreateDisplaySubject(input: Record<string, unknown>): string {
	for (const key of ["subject", "description", "activeForm"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
	return "";
}

export function getTaskCreateParams(input: Record<string, unknown>): Array<{key: string; value: string}> {
	const subject = getTaskCreateDisplaySubject(input);
	const description = inputString(input, "description") ?? "";
	const activeForm = inputString(input, "activeForm") ?? "";
	const params: Array<{key: string; value: string}> = [];
	if (subject) params.push({key: "subject", value: subject});
	if (description && description !== subject) {
		params.push({key: "description", value: description});
	}
	if (activeForm && activeForm !== subject) {
		params.push({key: "activeForm", value: activeForm});
	}
	return params;
}

/** Read a boolean field from an unvalidated tool input; anything else is undefined. */
export function inputBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
	const value = input[key];
	return typeof value === "boolean" ? value : undefined;
}

/** Read a finite number field from an unvalidated tool input; anything else is undefined. */
export function inputNumber(input: Record<string, unknown>, key: string): number | undefined {
	const value = input[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Read an all-strings array field from an unvalidated tool input; anything else is undefined. */
export function inputStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
	const value = input[key];
	return Array.isArray(value) && value.every((item): item is string => typeof item === "string") ? value : undefined;
}
