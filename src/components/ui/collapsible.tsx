import {Collapsible as BaseCollapsible} from "@base-ui/react/collapsible";
import {type ComponentProps, type ReactNode, type Ref, useCallback} from "react";

import {
	COLLAPSIBLE_CARET_CLASS,
	COLLAPSIBLE_PANEL_CLASS,
	COLLAPSIBLE_TRIGGER_CLASS,
	mergeClassNames,
	ROW_END_CARET_INK,
} from "./collapsible-classes";
import {Icon} from "./icon";
import {useAnimatingAttr} from "./use-animating-attr";

/*
 * Upstream's cds `Collapsible` (shared-frame `kT = {Root: tG, Trigger: Y4, Panel}`), wrapping the same Base UI
 * primitive. Copied: the `data-cds` root, the `group/clp` trigger class (`CS`), the rotating caret (`x1`) with
 * `caretPosition` / `hideCaret` / `render`, the multi-click selection guard (`NE` + `Cc`), and the height-animated
 * panel (`wY` / `Ma`) with its `data-animating` clip/contain hook (`lp` / `D$`). Import it as a namespace:
 * `import * as Collapsible from "./ui/collapsible"`, then `Collapsible.Root` / `.Trigger` / `.Panel`.
 */

const EDITABLE_TARGET =
	"input:not([type='hidden']):not([disabled]),[contenteditable]:not([contenteditable='false']),textarea:not([disabled])";

/** Upstream `Cc`: a double or triple primary click on a control doesn't select its text. */
function preventMultiClickSelection(event: {
	detail: number;
	button: number;
	target: EventTarget;
	preventDefault: () => void;
}) {
	if (event.detail <= 1 || event.button !== 0) return;
	const target = event.target;
	if (target instanceof Element && target.closest(EDITABLE_TARGET) !== null) return;
	event.preventDefault();
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
	if (typeof ref === "function") ref(value);
	else if (ref !== null && ref !== undefined) ref.current = value;
}

type RootProps = ComponentProps<typeof BaseCollapsible.Root>;

export function Root(props: RootProps) {
	return <BaseCollapsible.Root data-cds="Collapsible" {...props} />;
}

type BaseTriggerProps = ComponentProps<typeof BaseCollapsible.Trigger>;

export type CaretPosition = "start" | "end" | "row-end";

export interface CollapsibleTriggerProps extends Omit<BaseTriggerProps, "className" | "children"> {
	className?: string | undefined;
	children?: ReactNode;
	/** Default `start`: the caret before the label. `end` / `row-end` put it after, pushed to the row's end. */
	caretPosition?: CaretPosition | undefined;
	/** No caret; the caller draws its own. */
	hideCaret?: boolean | undefined;
}

export function Trigger({
	className,
	children,
	caretPosition,
	hideCaret = false,
	render,
	onMouseDown,
	...rest
}: CollapsibleTriggerProps) {
	const handleMouseDown: BaseTriggerProps["onMouseDown"] = (event) => {
		onMouseDown?.(event);
		preventMultiClickSelection(event);
	};
	if (render !== undefined) {
		return (
			<BaseCollapsible.Trigger
				render={render}
				{...(className !== undefined && {className})}
				{...rest}
				onMouseDown={handleMouseDown}
			>
				{children}
			</BaseCollapsible.Trigger>
		);
	}
	const atEnd = caretPosition === "end" || caretPosition === "row-end";
	const caretClass = [
		COLLAPSIBLE_CARET_CLASS,
		...(atEnd ? ["ms-auto"] : []),
		...(caretPosition === "row-end" ? [ROW_END_CARET_INK] : []),
	].join(" ");
	const caret = hideCaret ? null : (
		<Icon
			name={caretPosition === "row-end" ? "CaretRight" : "CaretRightFilled"}
			size="sm"
			className={caretClass}
			{...(caretPosition === "end" && {style: {translate: "0 0.5px"}})}
		/>
	);
	return (
		<BaseCollapsible.Trigger
			{...rest}
			className={mergeClassNames(COLLAPSIBLE_TRIGGER_CLASS, className)}
			onMouseDown={handleMouseDown}
		>
			{!atEnd && caret}
			{children}
			{atEnd && caret}
		</BaseCollapsible.Trigger>
	);
}

type BasePanelProps = ComponentProps<typeof BaseCollapsible.Panel>;

export interface CollapsiblePanelProps extends Omit<BasePanelProps, "className"> {
	className?: string | undefined;
}

export function Panel({className, ref, ...rest}: CollapsiblePanelProps) {
	const animatingRef = useAnimatingAttr();
	const mergedRef = useCallback(
		(element: HTMLDivElement | null) => {
			assignRef(ref, element);
			const cleanup = animatingRef(element);
			return () => {
				cleanup?.();
				assignRef(ref, null);
			};
		},
		[ref, animatingRef],
	);
	return (
		<BaseCollapsible.Panel
			ref={mergedRef}
			{...rest}
			className={mergeClassNames(COLLAPSIBLE_PANEL_CLASS, className)}
		/>
	);
}
