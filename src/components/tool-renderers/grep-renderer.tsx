import {inputBoolean, inputNumber, inputString} from "../../lib/tool-utils";
import type {ToolRendererProps} from "./types";
import {KeyValueCard} from "./shared";

export function GrepRenderer({toolCall}: ToolRendererProps) {
	const pattern = inputString(toolCall.input, "pattern") ?? "";
	const path = inputString(toolCall.input, "path");
	const glob = inputString(toolCall.input, "glob");
	const fileType = inputString(toolCall.input, "type");
	const outputMode = inputString(toolCall.input, "output_mode");
	const caseInsensitive = inputBoolean(toolCall.input, "-i");
	const headLimit = inputNumber(toolCall.input, "head_limit");
	const {result, isError} = toolCall;

	const params: Array<{key: string; value: string}> = [];
	if (pattern) params.push({key: "pattern", value: pattern});
	if (outputMode) params.push({key: "output_mode", value: outputMode});
	if (glob) params.push({key: "glob", value: glob});
	if (fileType) params.push({key: "type", value: fileType});
	if (path) params.push({key: "path", value: path});
	if (caseInsensitive) params.push({key: "-i", value: "true"});
	if (headLimit !== undefined) params.push({key: "head_limit", value: String(headLimit)});

	return <KeyValueCard isError={isError} params={params} result={result ?? undefined} />;
}
