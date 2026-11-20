import {type ReactNode, type RefObject, type SyntheticEvent, type TouchEvent} from "react";
import {flushSync} from "react-dom";
import {redispatch} from "./use-lazy-menu-trigger";

/**
 * The area that opens a right-click menu, standing in for Base UI's context-menu trigger so the
 * row inside it never remounts. Its right-clicks and touches go to `triggerRef` (a hidden trigger
 * inside the lazily mounted root), mounting that root first when `onFirstUse` hasn't yet.
 */
export function ContextMenuArea({
	mounted,
	onFirstUse,
	triggerRef,
	children,
}: {
	mounted: boolean;
	onFirstUse: () => void;
	triggerRef: RefObject<HTMLDivElement | null>;
	children: ReactNode;
})
{
	const forward = (event: SyntheticEvent<HTMLDivElement>, mounts: boolean) =>
	{
		if (!mounted)
		{
			if (!mounts) return;
			flushSync(onFirstUse);
		}
		const trigger = triggerRef.current;
		if (trigger === null) return;
		// The forwarded copy bubbles on from the trigger, so the original stops here.
		event.stopPropagation();
		if (event.type === "contextmenu") event.preventDefault();
		redispatch(trigger, event.nativeEvent);
	};
	const touch = (mounts: boolean) => (event: TouchEvent<HTMLDivElement>) =>
	{
		forward(event, mounts);
	};
	return (
		<div
			style={
			{
				WebkitTouchCallout: "none",
			}}
			onContextMenu={(event) =>
			{
				forward(event, true);
			}}
			onTouchStart={touch(true)}
			onTouchMove={touch(false)}
			onTouchEnd={touch(false)}
			onTouchCancel={touch(false)}
		>
			{children}
		</div>
	);
}
