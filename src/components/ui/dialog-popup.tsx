import {AlertDialog} from "@base-ui/react/alert-dialog";
import {Dialog} from "@base-ui/react/dialog";
import {type ComponentProps, type Ref, type RefObject, useCallback} from "react";

import {useTallWindowRef} from "./dialog-band";
import {useDialogPad} from "./dialog-pad";
import {useDialogFinalFocus} from "./use-dialog-final-focus";
import {overlayAttrs} from "../../lib/overlay";

interface PopupFocusProps
{
	/** Upstream `Dialog.Root`'s `modal`; every local dialog is modal. */
	modal?: boolean;
	/** Upstream `DialogTriggerRefContext`: the trigger to return to when nothing held focus at open. */
	triggerRef?: RefObject<Element | null>;
	/** Read at close: `false` keeps focus where the caller put it (navigation, a jump), skipping the return. */
	restoreFocus?: () => boolean;
}

type DialogPopupProps = ComponentProps<typeof Dialog.Popup> &
	PopupFocusProps &
	{
		/**
		 * Upstream `lZ` without the styled `js` markers: no `data-cds="Dialog"`/`data-cds-fizzy`. A full-screen
		 * modal passes `data-cds="Dialog"` itself so it still closes the ⌘K palette (upstream `YI`).
		 */
		unstyled?: boolean;
	};

/**
 * Upstream's cds `Dialog.Popup` (shared-frame `lZ`, styled by `js`): `data-cds="Dialog"` and `data-cds-fizzy`
 * under panels (unless `unstyled`), upstream's `data-cds-overlay` marker, the `An()` tall-window ref, and the
 * `Eo` final focus, which an explicit `finalFocus` overrides. Every local dialog renders its popup through
 * this wrapper so popup-level behaviour lives in one place.
 */
export function DialogPopup({
	ref,
	finalFocus,
	modal = true,
	triggerRef,
	restoreFocus,
	unstyled = false,
	className,
	...props
}: DialogPopupProps)
{
	const {popup} = useDialogPad();
	const tallWindowRef = useTallWindowRef();
	const focus = useDialogFinalFocus(
		{
			open: true,
			modal,
			triggerRef,
		},
	);
	const popupRef = focus.popupRef;
	const mergedRef = useCallback(
		(element: HTMLDivElement | null) =>
		{
			popupRef(element);
			tallWindowRef(element);
			assignRef(ref, element);
		},
		[popupRef, tallWindowRef, ref],
	);
	const hookFinalFocus = focus.finalFocus;
	const gatedFinalFocus = useCallback<typeof hookFinalFocus>(
		(closeType) => (restoreFocus?.() === false ? false : hookFinalFocus(closeType)),
		[restoreFocus, hookFinalFocus],
	);
	return (
		<Dialog.Popup
			{...overlayAttrs}
			{...(unstyled ? {} : popup)}
			{...props}
			className={unstyled ? className : withPageBg(className)}
			ref={mergedRef}
			finalFocus={finalFocus ?? gatedFinalFocus}
		/>
	);
}

/*
 * Upstream's Dialog portal container sets `--cds-page-bg: var(--cds-surface-popover)`, so page-coloured
 * surfaces inside a styled dialog (the sticky header band's `bg-page`) match the popup instead of the page.
 */
const PAGE_BG_CLASS = "[--color-page:var(--color-surface-popover)]";

function withPageBg(className: DialogPopupProps["className"]): DialogPopupProps["className"]
{
	if (typeof className === "function") return (state) => prependPageBg(className(state));
	return prependPageBg(className);
}

function prependPageBg(className: string | undefined): string
{
	return className === undefined ? PAGE_BG_CLASS : `${PAGE_BG_CLASS} ${className}`;
}

/** Upstream's cds `AlertDialog.Popup` (`wV` + `E9`'s `Eo(open)`): the overlay marker and the `Eo` final focus. */
export function AlertDialogPopup({
	ref,
	finalFocus,
	triggerRef,
	...props
}: ComponentProps<typeof AlertDialog.Popup> & Omit<PopupFocusProps, "modal" | "restoreFocus">)
{
	const tallWindowRef = useTallWindowRef();
	const focus = useDialogFinalFocus(
		{
			open: true,
			triggerRef,
		},
	);
	const popupRef = focus.popupRef;
	const mergedRef = useCallback(
		(element: HTMLDivElement | null) =>
		{
			popupRef(element);
			tallWindowRef(element);
			assignRef(ref, element);
		},
		[popupRef, tallWindowRef, ref],
	);
	return (
		<AlertDialog.Popup {...overlayAttrs} {...props} ref={mergedRef} finalFocus={finalFocus ?? focus.finalFocus} />
	);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null)
{
	if (typeof ref === "function") ref(value);
	else if (ref !== null && ref !== undefined) ref.current = value;
}
