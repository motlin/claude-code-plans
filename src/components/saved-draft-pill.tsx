import {lazy, Suspense, useRef, useState} from "react";

import {type ContextChip, savedDraftAriaLabel, updateContextChipText} from "../lib/context-attach";
import {RemoveSavedDraftConfirm} from "./remove-saved-draft-confirm";
import {Icon} from "./ui/icon";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";

// The editor loads only when the pill opens, keeping its dialog out of the composer chunk.
const SavedDraftDialog = lazy(async () =>
	import("./saved-draft-dialog").then((module) => (
	{
		default: module.SavedDraftDialog,
	})),
);

/** Upstream's flat `epitaxy-pill-body` (cc4a5adb7 `na` with `quiet`); pad-md is 8px at default density, 12px comfortable. */
const PILL_BODY_CLASS =
	"epitaxy-pill-body overflow-hidden focus-visible:outline-hidden focus-visible:shadow-focus hide-focus-ring rounded-sm border-0 inline-flex items-center gap-1.25 h-10 px-2 comfortable:px-3 text-secondary-control text-body epitaxy-pill-body--flat bg-alpha-2 text-muted-control";

const PILL_REMOVE_CLASS =
	"epitaxy-pill-remove absolute -top-1.5 -end-1.5 z-10 grid place-items-center size-4 rounded-full bg-surface-2 text-secondary ring-1 ring-alpha-2 opacity-0 pointer-events-none transition-opacity motion-reduce:transition-none group-hover/pill:opacity-100 group-hover/pill:pointer-events-auto group-focus-within/pill:opacity-100 group-focus-within/pill:pointer-events-auto hover:text-primary";

/**
 * Upstream's "Saved draft" pill (cc4a5adb7 `va` → `na`): a stored draft too long to restore inline. Click or
 * menu Edit opens its editor; ×, Delete/Backspace and menu Remove ask first, since it is the only copy.
 * While an upload is in flight it is view-only: no remove, and the editor can't save.
 */
export function SavedDraftPill({
	sessionId,
	chip,
	restored,
	readOnly,
	onRemove,
}: {
	sessionId: string;
	chip: ContextChip;
	restored: boolean;
	readOnly: boolean;
	/** Removes the chip, handing focus from `item` to its neighbour or the prompt. */
	onRemove: (item: HTMLElement | null) => void;
})
{
	const itemRef = useRef<HTMLLIElement>(null);
	const bodyRef = useRef<HTMLButtonElement>(null);
	// Upstream keys the dialog `${id}:${opening}`, so every open remounts it.
	const [opening, setOpening] = useState<number | null>(null);
	const opens = useRef(0);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const text = chip.text ?? "";
	const open = () =>
	{
		opens.current += 1;
		setOpening(opens.current);
	};
	const requestRemove = () =>
	{
		if (!readOnly) setConfirmRemove(true);
	};
	const remove = () =>
	{
		onRemove(itemRef.current);
	};
	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={<li ref={itemRef} />}
				data-cds-attachment=""
				data-chip-label="Saved draft"
				{...(restored
					?
						{
							"data-cds-attachment-restored": "",
						}
					: {})}
				style={
				{
					"--cds-attachment-vt-name": `cds-attachment-${chip.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`,
				}}
				className="group/pill relative shrink-0 hover:z-10 focus-within:z-10"
			>
				<Tooltip content="Saved draft" stacked detail={readOnly ? "Click to view." : "Click to edit."}>
					<button
						ref={bodyRef}
						type="button"
						aria-label={savedDraftAriaLabel(text.length)}
						aria-haspopup="dialog"
						onClick={open}
						onKeyDown={(event) =>
						{
							if (event.key !== "Delete" && event.key !== "Backspace") return;
							if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
							if (event.repeat || event.nativeEvent.isComposing) return;
							event.preventDefault();
							requestRemove();
						}}
						className={PILL_BODY_CLASS}
					>
						<span className="flex items-center justify-center shrink-0">
							<Icon name="Note" customSize={12} />
						</span>
						<span className="truncate max-w-[260px]">Saved draft</span>
					</button>
				</Tooltip>
				{readOnly ? null : (
					<button
						type="button"
						tabIndex={-1}
						aria-label="Remove Saved draft"
						onMouseDown={(event) =>
						{
							event.preventDefault();
						}}
						onClick={requestRemove}
						className={PILL_REMOVE_CLASS}
					>
						<Icon name="X" customSize={12} />
					</button>
				)}
			</ContextMenuTrigger>
			<MenuContent>
				<MenuItem onSelect={open}>Edit</MenuItem>
				{readOnly ? null : <MenuItem onSelect={requestRemove}>Remove</MenuItem>}
			</MenuContent>
			<RemoveSavedDraftConfirm open={confirmRemove} onOpenChange={setConfirmRemove} onConfirm={remove} />
			{opening === null ? null : (
				<Suspense fallback={null}>
					<SavedDraftDialog
						key={`${chip.id}:${opening}`}
						text={text}
						readOnly={readOnly}
						onSave={(next) =>
						{
							updateContextChipText(sessionId, chip.id, next);
						}}
						onRemove={remove}
						onClose={() =>
						{
							setOpening(null);
						}}
						finalFocus={() => (bodyRef.current?.isConnected === true ? bodyRef.current : true)}
					/>
				</Suspense>
			)}
		</ContextMenu>
	);
}
