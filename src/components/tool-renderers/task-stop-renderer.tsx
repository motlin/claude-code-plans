import {inputString} from "../../lib/tool-utils";
import type {ToolRendererProps} from "./types";
import {KeyValueCard} from "./shared";

export function TaskStopRenderer({toolCall}: ToolRendererProps) {
	const taskId = inputString(toolCall.input, "task_id") ?? "";

	const params: Array<{key: string; value: string}> = [];
	if (taskId) params.push({key: "task_id", value: `#${taskId}`});

	return <KeyValueCard isError={toolCall.isError} params={params} result={toolCall.result ?? undefined} />;
}
