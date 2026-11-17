import {type RefObject, useEffect, useEffectEvent, useState} from "react";
import {splitDroppedItems} from "../lib/drop-items";

export type FileDropState = "idle" | "off-target" | "on-target";

function hasFiles(e: DragEvent): boolean
{
	return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

function inside(target: RefObject<HTMLElement | null> | undefined, node: EventTarget | null): boolean
{
	const element = target?.current;
	return element != null && node instanceof Node && element.contains(node);
}

/** A page target (the session composer) or an open overlay (the ⌘K palette), which always outranks page targets. */
export type FileDropPriority = "page" | "overlay";

interface Owner
{
	readonly priority: FileDropPriority;
}

/**
 * Drop targets in claim order; the last one owns drops. Overlay targets stay above every page target, so a composer that
 * mounts or takes focus under the open palette can't steal its drops (upstream's cds registry routes to the innermost
 * zone, and the palette's full-page zone covers the composer). Focusing inside a target's `targetRef` re-claims it.
 */
const owners: Owner[] = [];

function claim(owner: Owner)
{
	const index = owners.indexOf(owner);
	if (index !== -1) owners.splice(index, 1);
	const firstOverlay = owners.findIndex((other) => other.priority === "overlay");
	if (owner.priority === "page" && firstOverlay !== -1) owners.splice(firstOverlay, 0, owner);
	else owners.push(owner);
}

/**
 * Upstream's page-scoped file drop hook (shared-5 `f7`): capture listeners on the body track whether files are being
 * dragged over the page (`on-target` when over `targetRef`), and a drop anywhere on the page attaches. When several
 * targets are mounted, only the owner (see `owners`) reacts. Like the Code session composer's drop (`cc970fefe` `WJ`),
 * dropped folders are left out (upstream `zt`), and a drop of only folders still prevents the browser opening it but
 * calls nothing. `onTransferDrop` replaces that splitting with the raw `DataTransfer`, read synchronously in the drop
 * handler, for a target that walks dropped folders itself (the palette zone).
 */
export function useFileDropTarget({
	onFileDrop,
	onTransferDrop,
	disabled = false,
	targetRef,
	priority = "page",
}: {
	onFileDrop?: (files: readonly File[]) => void;
	onTransferDrop?: (transfer: DataTransfer) => void;
	disabled?: boolean;
	targetRef?: RefObject<HTMLElement | null>;
	priority?: FileDropPriority;
}): FileDropState
{
	const [state, setState] = useState<FileDropState>("idle");
	const drop = useEffectEvent((transfer: DataTransfer | null) =>
	{
		if (onTransferDrop !== undefined)
		{
			if (transfer !== null) onTransferDrop(transfer);
			return;
		}
		const {files} = splitDroppedItems(transfer?.items, transfer?.files);
		if (files.length > 0) onFileDrop?.(files);
	});

	useEffect(() =>
	{
		if (disabled) return undefined;
		const body = targetRef?.current?.ownerDocument.body ?? document.body;
		const owner: Owner =
		{
			priority,
		};
		claim(owner);
		const owns = () => owners.at(-1) === owner;
		const reset = () =>
		{
			setState("idle");
		};
		const onFocusIn = (e: FocusEvent) =>
		{
			if (inside(targetRef, e.target)) claim(owner);
		};
		const onDragOver = (e: DragEvent) =>
		{
			if (!hasFiles(e)) return;
			if (!owns())
			{
				reset();
				return;
			}
			e.preventDefault();
			setState(inside(targetRef, e.target) ? "on-target" : "off-target");
		};
		const onDragLeave = (e: DragEvent) =>
		{
			if (!hasFiles(e) || inside(targetRef, e.relatedTarget)) return;
			if (e.relatedTarget === null || e.target === body) reset();
		};
		const onDrop = (e: DragEvent) =>
		{
			if (!hasFiles(e)) return;
			reset();
			if (!owns()) return;
			e.preventDefault();
			drop(e.dataTransfer);
		};
		body.addEventListener("dragover", onDragOver, true);
		body.addEventListener("dragleave", onDragLeave, true);
		body.addEventListener("dragend", reset, true);
		body.addEventListener("pointerdown", reset, true);
		body.addEventListener("drop", onDrop);
		body.addEventListener("focusin", onFocusIn, true);
		return () =>
		{
			owners.splice(owners.indexOf(owner), 1);
			body.removeEventListener("focusin", onFocusIn, true);
			body.removeEventListener("dragover", onDragOver, true);
			body.removeEventListener("dragleave", onDragLeave, true);
			body.removeEventListener("dragend", reset, true);
			body.removeEventListener("pointerdown", reset, true);
			body.removeEventListener("drop", onDrop);
			reset();
		};
	}, [disabled, targetRef, priority]);

	return disabled ? "idle" : state;
}
