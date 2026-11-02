import type {ComponentProps} from "react";

import {ResizeHandle} from "./resize-handle";

/** Upstream's `layer(5)`: the file column handles' z-index. */
export const FILE_COLUMN_HANDLE_Z = 5;

type EdgeHandleProps = Omit<ComponentProps<typeof ResizeHandle>, "aria-label" | "className" | "style">;

/**
 * Upstream's c44d00c7f `Mi`: while a file column is hidden, a 3px strip at the pane edge (no half
 * clip, no onBorder ring, inert pill) that shows the column on a click, Enter/Space, an Arrow toward
 * the viewer, or a drag past 80px.
 */
export function FileColumnEdgeHandle({handleProps, label}: {handleProps: EdgeHandleProps; label: string})
{
	const position = handleProps.side === "inline-start" ? "pointer-events-none start-auto end-0" : "start-0 end-auto";
	return (
		<div className="relative w-0 shrink-0">
			<ResizeHandle
				{...handleProps}
				aria-label={label}
				className={`w-[3px] [&>*]:pointer-events-none ${position}`}
				style={
				{
					zIndex: FILE_COLUMN_HANDLE_Z,
				}}
			/>
		</div>
	);
}
