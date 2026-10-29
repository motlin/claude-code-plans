import {type RefObject, useCallback, useEffect, useRef, useState} from "react";

import {flattenOffsets} from "../../lib/plan-comment-offsets";
import {addPlanComment, planCommentOverlaps} from "../../lib/plan-comments";
import {PlanCommentPopover, type PlanSelection} from "./plan-comment-popover";

/** Upstream waits this long after a double or triple click so the word or line selection settles. */
const MULTI_CLICK_DELAY_MS = 250;

/**
 * Upstream's selection trigger for Plan pane comments: a mouse drag that starts inside the pane and
 * moves the selection opens the "Comment on selection" popover on mouseup. Keyboard selections never
 * open it, and neither does a blank, code-only or already-commented selection, comments being off,
 * or a popover holding a draft.
 */
export function PlanCommentsLayer({
	rootRef,
	sessionId,
	commentsEnabled,
}: {
	/** The rendered plan text; offsets count from its start. */
	rootRef: RefObject<HTMLElement | null>;
	sessionId: string;
	commentsEnabled: boolean;
}) {
	const [selection, setSelection] = useState<PlanSelection | null>(null);
	const [draft, setDraft] = useState("");
	const dirtyRef = useRef(false);
	dirtyRef.current = selection !== null && draft.trim() !== "";

	useEffect(() => {
		let startedInside = false;
		let moved = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const check = () => {
			const root = rootRef.current;
			const current = document.getSelection();
			if (root === null || current === null || !commentsEnabled || dirtyRef.current) return;
			if (current.isCollapsed || current.rangeCount === 0 || !root.contains(current.anchorNode)) return;
			const range = current.getRangeAt(0).cloneRange();
			const flat = flattenOffsets(root, range);
			if (flat === null || planCommentOverlaps(sessionId, flat.start, flat.end)) return;
			setDraft("");
			setSelection({range, ...flat});
		};

		const onMouseDown = (event: MouseEvent) => {
			startedInside = event.target instanceof Node && rootRef.current?.contains(event.target) === true;
			moved = false;
		};
		const onSelectionChange = () => {
			moved = true;
		};
		const onMouseUp = (event: MouseEvent) => {
			const run = startedInside && moved;
			startedInside = false;
			moved = false;
			if (!run) return;
			clearTimeout(timer);
			if (event.detail >= 2) timer = setTimeout(check, MULTI_CLICK_DELAY_MS);
			else check();
		};

		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("selectionchange", onSelectionChange);
		document.addEventListener("mouseup", onMouseUp);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("selectionchange", onSelectionChange);
			document.removeEventListener("mouseup", onMouseUp);
		};
	}, [rootRef, sessionId, commentsEnabled]);

	const close = useCallback(() => {
		setSelection(null);
		setDraft("");
	}, []);

	const root = rootRef.current;
	if (selection === null || root === null) return null;
	return (
		<PlanCommentPopover
			selection={selection}
			boundary={root.closest<HTMLElement>("[data-plan-scroll]") ?? root}
			value={draft}
			onChange={setDraft}
			onSave={(comment) => {
				addPlanComment(sessionId, {
					selectedText: selection.text,
					startOffset: selection.start,
					endOffset: selection.end,
					comment,
				});
				close();
			}}
			onClose={close}
		/>
	);
}
