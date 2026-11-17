import {ConfirmDialog} from "./confirm-dialog";

/** Upstream's "Remove saved draft?" confirm, shared by the pill's remove and a blank Save. */
export function RemoveSavedDraftConfirm({
	open,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
})
{
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Remove saved draft?"
			body="This is the only copy of this text."
			confirmLabel="Remove"
			variant="danger"
			initialFocus="confirm"
			onConfirm={onConfirm}
		/>
	);
}
