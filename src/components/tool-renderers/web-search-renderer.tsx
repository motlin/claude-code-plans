import {inputString, inputStringArray} from "../../lib/tool-utils";
import type {ToolRendererProps} from "./types";
import {KeyValueCard} from "./shared";

export function WebSearchRenderer({toolCall}: ToolRendererProps) {
	const query = inputString(toolCall.input, "query") ?? "";
	const allowedDomains = inputStringArray(toolCall.input, "allowed_domains");
	const blockedDomains = inputStringArray(toolCall.input, "blocked_domains");
	const {result, isError} = toolCall;

	const params: Array<{key: string; value: string}> = [];
	if (query) params.push({key: "query", value: query});
	if (allowedDomains && allowedDomains.length > 0) {
		params.push({key: "allowed_domains", value: allowedDomains.join(", ")});
	}
	if (blockedDomains && blockedDomains.length > 0) {
		params.push({key: "blocked_domains", value: blockedDomains.join(", ")});
	}

	return <KeyValueCard isError={isError} params={params} result={result ?? undefined} />;
}
