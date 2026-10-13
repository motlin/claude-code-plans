import {inputString} from "../../lib/tool-utils";
import type {ToolRendererProps} from "./types";
import {KeyValueCard} from "./shared";

export function TaskUpdateRenderer({toolCall}: ToolRendererProps) {
	const taskId = inputString(toolCall.input, "taskId") ?? "";
	const status = inputString(toolCall.input, "status") ?? "";
	const subject = inputString(toolCall.input, "subject") ?? "";
	const description = inputString(toolCall.input, "description") ?? "";

	const params: Array<{key: string; value: string}> = [];
	if (taskId) params.push({key: "taskId", value: `#${taskId}`});
	if (status) params.push({key: "status", value: status});
	if (subject) params.push({key: "subject", value: subject});
	if (description) params.push({key: "description", value: description});

	return <KeyValueCard isError={toolCall.isError} params={params} result={toolCall.result ?? undefined} />;
}
