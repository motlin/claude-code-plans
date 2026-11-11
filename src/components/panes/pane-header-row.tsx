import type {ReactNode, Ref} from "react";
import {TOOLBAR_ROVING_OPTIONS, useRovingToolbar} from "../../lib/use-roving-toolbar";

/**
 * Upstream's pane frame toolbar (`Hn`'s header, shared-38 `ve`): the cds Toolbar padded by the toolbar tokens, so the
 * row is pad + control + pad + strip tall (45px comfortable on a fine pointer, 33px at the default density).
 */
const PANE_HEADER_TOOLBAR_CLASS =
	"flex shrink-0 items-center gap-xs px-[var(--cds-toolbar-pad-block)] pt-[var(--cds-toolbar-pad-block,0.5rem)] pb-[calc(var(--cds-toolbar-pad-block,0.5rem)+var(--cds-toolbar-strip,0px))] outline-none";

/** Upstream's pane Close control hook class (`epitaxy-pane-close-control`), which other upstream rules key off. */
export const PANE_CLOSE_CONTROL_CLASS = "epitaxy-pane-close-control";

/**
 * Upstream's pane header line: `div[data-pane-corner-row]` holding the `role=toolbar` "<title> controls" (a title area
 * and the `data-pane-actions` cluster) with the Move handle beside the toolbar.
 */
export function PaneHeaderRow({
	label,
	title,
	actions,
	moveHandle,
	rowRef,
	rowAttributes,
}: {
	/** The pane's name; the toolbar is labelled "<label> controls". */
	label: string;
	title: ReactNode;
	actions: ReactNode;
	moveHandle: ReactNode;
	rowRef?: Ref<HTMLDivElement>;
	/** Pane-specific hooks on the corner row, such as `data-files-header`. */
	rowAttributes?: Readonly<Record<`data-${string}`, string>>;
}) {
	const roving = useRovingToolbar(TOOLBAR_ROVING_OPTIONS);
	return (
		<div ref={rowRef} data-pane-corner-row="" {...rowAttributes} className="relative shrink-0">
			{/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- upstream's root has no tabindex; the roving hook keeps one item at 0 and adds 0 to the root only while focus parks on it */}
			<div
				ref={roving.ref}
				role="toolbar"
				aria-label={`${label} controls`}
				data-cds="Toolbar"
				onFocus={roving.onFocus}
				onKeyDown={roving.onKeyDown}
				className={PANE_HEADER_TOOLBAR_CLASS}
			>
				<div className="flex min-w-0 flex-1 items-center gap-1 self-stretch">
					<div className="flex min-h-[var(--cds-h-control)] min-w-0 flex-1 items-center gap-1">
						<div className="z-[1] flex min-w-0 flex-1 items-center draggable-none">{title}</div>
					</div>
				</div>
				<div data-pane-actions="" className="relative z-[2] flex shrink-0 empty:hidden">
					<div className="relative z-[1] flex shrink-0 items-center gap-[calc(0.25rem*var(--cds-rem-scale,1))] draggable-none">
						{actions}
					</div>
				</div>
			</div>
			{moveHandle}
		</div>
	);
}
