import {Dialog} from "@base-ui/react/dialog";
import {type ComponentProps, type Ref, useCallback} from "react";

import {useTallWindowRef} from "./dialog-band";
import {useDialogPad} from "./dialog-pad";

/**
 * Upstream's styled cds `Dialog.Popup` (shared-frame `js` rendered through `lZ`): `data-cds="Dialog"`,
 * `data-cds-fizzy` under panels, and the `An()` tall-window ref. Every styled local dialog renders its
 * popup through this wrapper so popup-level behaviour lives in one place.
 */
export function DialogPopup({ref, ...props}: ComponentProps<typeof Dialog.Popup>) {
	const {popup} = useDialogPad();
	const tallWindowRef = useTallWindowRef();
	const mergedRef = useCallback(
		(element: HTMLDivElement | null) => {
			tallWindowRef(element);
			assignRef(ref, element);
		},
		[tallWindowRef, ref],
	);
	return <Dialog.Popup {...popup} {...props} ref={mergedRef} />;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
	if (typeof ref === "function") ref(value);
	else if (ref !== null && ref !== undefined) ref.current = value;
}
