import {inputString} from "../../lib/tool-utils";
import type {ToolRendererProps} from "./types";
import {KeyValueCard} from "./shared";

export function SendMessageRenderer({toolCall}: ToolRendererProps) {
	const recipient = inputString(toolCall.input, "to", "recipient") ?? "";
	const message = inputString(toolCall.input, "message", "content", "prompt") ?? "";
	const summary = inputString(toolCall.input, "summary") ?? "";

	const params: Array<{key: string; value: string}> = [];
	if (recipient) params.push({key: "to", value: recipient});
	if (summary) params.push({key: "summary", value: summary});
	if (message) params.push({key: "message", value: message});

	return <KeyValueCard isError={toolCall.isError} params={params} result={toolCall.result ?? undefined} />;
}
