import {inputNumber, inputString} from "../../lib/tool-utils";
import type {ToolRendererProps} from "./types";
import {KeyValueCard} from "./shared";

export function ToolSearchRenderer({toolCall}: ToolRendererProps) {
	const query = inputString(toolCall.input, "query") ?? "";
	const maxResults = inputNumber(toolCall.input, "max_results");
	const {result, isError} = toolCall;

	const params: Array<{key: string; value: string}> = [];
	if (query) params.push({key: "query", value: query});
	if (maxResults !== undefined) params.push({key: "max_results", value: String(maxResults)});

	return <KeyValueCard isError={isError} params={params} result={result ?? undefined} />;
}
