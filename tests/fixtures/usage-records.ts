export function assistantUsage(id: string, model: string, usage: Record<string, unknown>) {
	return {type: "assistant", message: {role: "assistant", id, model, content: [], usage}};
}

/** Two models; `msg_opus_1` is split across two records that repeat its usage, as Claude Code writes it. */
export const USAGE_RECORDS: readonly unknown[] = [
	{type: "user", message: {role: "user", content: "hi"}},
	assistantUsage("msg_opus_1", "claude-opus-5-5[1m]", {
		input_tokens: 100,
		output_tokens: 200,
		cache_read_input_tokens: 10_000,
		cache_creation_input_tokens: 2_000,
	}),
	assistantUsage("msg_opus_1", "claude-opus-5-5[1m]", {
		input_tokens: 100,
		output_tokens: 200,
		cache_read_input_tokens: 10_000,
		cache_creation_input_tokens: 2_000,
	}),
	assistantUsage("msg_opus_2", "claude-opus-5-5", {
		input_tokens: 50,
		output_tokens: 300,
		cache_read_input_tokens: 20_000,
		cache_creation_input_tokens: 0,
	}),
	assistantUsage("msg_haiku_1", "claude-haiku-4-5-20251001", {
		input_tokens: 1_000,
		output_tokens: 500,
		cache_read_input_tokens: 0,
		cache_creation_input_tokens: 4_000,
		cache_creation: {ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 4_000},
	}),
	assistantUsage("msg_synthetic", "<synthetic>", {input_tokens: 0, output_tokens: 0}),
];
