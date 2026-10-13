import {Profiler, type ReactNode} from "react";
import {onSubtreeRender} from "./measure-interaction";

/** A named `<Profiler>` whose commits are reported under `commitsBySubtree[id]`. */
export function PerfSubtree({id, children}: {id: string; children: ReactNode}) {
	return (
		<Profiler id={id} onRender={onSubtreeRender}>
			{children}
		</Profiler>
	);
}
