import type {ToolRendererProps} from "./types";
import {KeyValueCard} from "./shared";
import {getTaskCreateParams} from "../../lib/tool-utils";

export function TaskCreateRenderer({toolCall}: ToolRendererProps) {
	return (
		<KeyValueCard
			isError={toolCall.isError}
			params={getTaskCreateParams(toolCall.input)}
			result={toolCall.result ?? undefined}
		/>
	);
}
