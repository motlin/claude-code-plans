import type {ToolRendererProps} from "./types";
import {KeyValueCard} from "./shared";

export function FallbackRenderer({toolCall}: ToolRendererProps) {
	const {input, result, isError} = toolCall;
	const entries = Object.entries(input).filter(([k]) => k !== "type");

	const params = entries.map(([key, value]) => ({
		key,
		value: typeof value === "string" ? value : JSON.stringify(value),
	}));

	return <KeyValueCard isError={isError} params={params} result={result ?? undefined} />;
}

/** A call whose input failed its tool's schema: the input exactly as written, then the result. */
export function InvalidInputRenderer({toolCall}: ToolRendererProps) {
	const {input, result, isError} = toolCall;
	const json = JSON.stringify(input, null, 2);
	return (
		<KeyValueCard isError={isError} params={[]} result={result ?? undefined} copyText={json}>
			<pre className="text-code font-mono whitespace-pre-wrap break-all">{json}</pre>
		</KeyValueCard>
	);
}
