import {inputBoolean, inputString} from "../../lib/tool-utils";
import type {ToolRendererProps} from "./types";
import {KeyValueCard} from "./shared";

export function CronCreateRenderer({toolCall}: ToolRendererProps) {
	const cron = inputString(toolCall.input, "cron") ?? "";
	const prompt = inputString(toolCall.input, "prompt") ?? "";
	const recurring = inputBoolean(toolCall.input, "recurring");
	const durable = inputBoolean(toolCall.input, "durable");

	const params: Array<{key: string; value: string}> = [];
	if (cron) params.push({key: "cron", value: cron});
	if (prompt) params.push({key: "prompt", value: prompt});
	if (recurring !== undefined) params.push({key: "recurring", value: String(recurring)});
	if (durable !== undefined) params.push({key: "durable", value: String(durable)});

	return <KeyValueCard isError={toolCall.isError} params={params} result={toolCall.result ?? undefined} />;
}
