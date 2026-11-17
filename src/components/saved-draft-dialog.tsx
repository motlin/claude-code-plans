import {Dialog} from "@base-ui/react/dialog";
import {useEffect, useRef, useState} from "react";

import {ConfirmDialog} from "./confirm-dialog";
import {RemoveSavedDraftConfirm} from "./remove-saved-draft-confirm";
import {cdsButtonClass} from "./ui/cds-button";
import {DensityScope} from "./ui/density";
import {useDialogBandBodyClass} from "./ui/dialog-band";
import {DIALOG_BODY_CLASS} from "./ui/dialog-classes";
import {DialogHeader} from "./ui/dialog-header";
import {useDialogPad} from "./ui/dialog-pad";
import {DialogPopup} from "./ui/dialog-popup";

/**
 * Upstream's Saved draft editor (cc4a5adb7 `jr` + `Ar`): a 3xl dialog holding the text in a monospace box
 * (upstream's lazy CodeMirror has no local package, so a textarea stands in), Save enabled once edited,
 * a Discard-changes guard on every dirty close, and a blank Save asking to remove the only copy. Unsaved
 * non-blank edits are saved when the dialog unmounts without a close (upstream `onUnroutedClose`).
 */
export function SavedDraftDialog({
	text,
	readOnly,
	onSave,
	onRemove,
	onClose,
	finalFocus,
}: {
	text: string;
	/** Upstream's view-only mode while an upload is in flight. */
	readOnly: boolean;
	onSave: (text: string) => void;
	/** Removes the saved draft, after the dialog's close completes. */
	onRemove: () => void;
	/** The close finished; the owner unmounts the dialog. */
	onClose: () => void;
	finalFocus: () => HTMLElement | boolean;
})
{
	const [open, setOpen] = useState(true);
	const [value, setValue] = useState(text);
	const [dirty, setDirty] = useState(false);
	const [ask, setAsk] = useState<"discard" | "remove" | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const afterClose = useRef<(() => void) | null>(null);
	const unsaved = useRef<string | null>(null);
	unsaved.current = dirty && !readOnly && open ? value : null;
	const save = useRef(onSave);
	save.current = onSave;
	const pad = useDialogPad();
	const bandBody = useDialogBandBodyClass();

	useEffect(
		() => () =>
		{
			const pending = unsaved.current;
			if (pending !== null && pending.trim() !== "") save.current(pending);
		},
		[],
	);

	const close = (then?: () => void) =>
	{
		afterClose.current = then ?? null;
		setOpen(false);
	};
	const requestClose = () =>
	{
		if (dirty && !readOnly) setAsk("discard");
		else close();
	};
	const submit = () =>
	{
		if (readOnly || !dirty) return;
		if (value.trim() === "") setAsk("remove");
		else
		{
			onSave(value);
			close();
		}
	};

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) =>
			{
				if (!next) requestClose();
			}}
			onOpenChangeComplete={(next) =>
			{
				if (next) return;
				afterClose.current?.();
				onClose();
			}}
		>
			<Dialog.Portal>
				<div className="pointer-events-auto relative z-[140]">
					<DensityScope density="comfortable">
						<Dialog.Backdrop className="fixed inset-0 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
						<DialogPopup
							initialFocus={textareaRef}
							finalFocus={finalFocus}
							className="fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1152px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body font-normal text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
						>
							<div className={`${DIALOG_BODY_CLASS} ${pad.p} ${bandBody}`}>
								<DialogHeader title="Saved draft" />
								<div className="flex max-h-64 flex-col overflow-hidden rounded border border-alpha-3">
									<textarea
										ref={textareaRef}
										aria-label="Saved draft text"
										value={value}
										readOnly={readOnly}
										spellCheck={false}
										onChange={(event) =>
										{
											setValue(event.target.value);
											setDirty(true);
										}}
										onKeyDown={(event) =>
										{
											if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
											event.preventDefault();
											submit();
										}}
										className="h-64 min-h-0 resize-none bg-transparent px-2 py-1 text-code text-primary outline-none"
									/>
								</div>
								<div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
									<button
										type="button"
										onClick={requestClose}
										className={cdsButtonClass("secondary")}
									>
										Cancel
									</button>
									<button
										type="button"
										disabled={readOnly || !dirty}
										onClick={submit}
										className={cdsButtonClass("primary")}
									>
										Save
									</button>
								</div>
							</div>
							<ConfirmDialog
								open={ask === "discard"}
								onOpenChange={(next) =>
								{
									if (!next) setAsk(null);
								}}
								title="Discard changes?"
								body="Your edits won’t be saved."
								cancelLabel="Keep editing"
								confirmLabel="Discard"
								variant="danger"
								onConfirm={() =>
								{
									close();
								}}
							/>
							<RemoveSavedDraftConfirm
								open={ask === "remove"}
								onOpenChange={(next) =>
								{
									if (!next) setAsk(null);
								}}
								onConfirm={() =>
								{
									close(onRemove);
								}}
							/>
						</DialogPopup>
					</DensityScope>
				</div>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
