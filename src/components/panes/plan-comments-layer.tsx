import {type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";

import {
	flattenOffsets,
	PLAN_COMMENT_ID_ATTR,
	unwrapPlanCommentMarks,
	wrapPlanCommentMarks,
} from "../../lib/plan-comment-offsets";
import {
	addPlanComment,
	getPlanComments,
	type PlanComment,
	planCommentOverlaps,
	removePlanComment,
	updatePlanComment,
	usePlanComments,
} from "../../lib/plan-comments";
import {PlanCommentPopover} from "./plan-comment-popover";

/** Upstream waits this long after a double or triple click so the word or line selection settles. */
const MULTI_CLICK_DELAY_MS = 250;

const MARK_CLASS =
	"rounded-xs text-inherit underline decoration-[var(--color-fill-accent)] decoration-2 underline-offset-2 px-0";
const MARK_REST_CLASS = "bg-[hsl(from_var(--color-fill-accent)_h_s_l/10%)]";
const MARK_HOVER_CLASS = "bg-[hsl(from_var(--color-fill-accent)_h_s_l/20%)]";
const MARK_BUTTON_CLASS = "text-inherit rounded-xs outline-none focus-visible:shadow-[var(--focus-shadow)]";

function markClass(hovered: boolean): string {
	return `${MARK_CLASS} ${hovered ? MARK_HOVER_CLASS : MARK_REST_CLASS}`;
}

/** Upstream's mark component: the highlighted text inside a focusable button span that opens the comment. */
function createMark(document: Document, id: string, text: string, hovered: boolean): HTMLElement {
	const mark = document.createElement("mark");
	mark.setAttribute(PLAN_COMMENT_ID_ATTR, id);
	mark.className = markClass(hovered);
	const button = document.createElement("span");
	button.setAttribute("role", "button");
	button.tabIndex = 0;
	button.className = MARK_BUTTON_CLASS;
	button.textContent = text;
	mark.append(button);
	return mark;
}

function markOf(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? target.closest<HTMLElement>(`mark[${PLAN_COMMENT_ID_ATTR}]`) : null;
}

function markButton(root: Element, id: string): HTMLElement | null {
	return root.querySelector<HTMLElement>(`mark[${PLAN_COMMENT_ID_ATTR}="${id}"] > span`);
}

type OpenPopover =
	| {mode: "selection"; range: Range; text: string; start: number; end: number}
	| {mode: "editing"; range: Range; comment: PlanComment};

/**
 * Upstream's Plan pane comments wrapper. A mouse drag that starts inside the pane and moves the
 * selection opens the "Comment on selection" popover on mouseup; keyboard selections never open it,
 * and neither does a blank, code-only or already-commented selection, comments being off, or a
 * popover holding a draft. Saved comments are underlined marks in the plan text that light up
 * together on hover and open the comment for editing on a click, Enter or Space, even with
 * comments off.
 */
export function PlanCommentsLayer({
	rootRef,
	content,
	sessionId,
	commentsEnabled,
}: {
	/** The rendered plan text; offsets count from its start. */
	rootRef: RefObject<HTMLElement | null>;
	/** The plan markdown, so the marks are re-applied when it re-renders. */
	content: string | null;
	sessionId: string;
	commentsEnabled: boolean;
}) {
	const [open, setOpen] = useState<OpenPopover | null>(null);
	const [draft, setDraft] = useState("");
	const opened = open?.mode === "editing" ? open.comment.comment : "";
	const dirtyRef = useRef(false);
	dirtyRef.current = open !== null && draft !== opened && draft.trim() !== "";
	const comments = usePlanComments(sessionId);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const hoveredRef = useRef(hoveredId);
	hoveredRef.current = hoveredId;
	/** The comment whose edit just closed, whose mark takes focus back if it would fall to the body. */
	const returnFocusRef = useRef<string | null>(null);

	useLayoutEffect(() => {
		const root = rootRef.current;
		if (root === null) return undefined;
		const apply = () => {
			observer.disconnect();
			unwrapPlanCommentMarks(root);
			wrapPlanCommentMarks(root, comments, (id, text) =>
				createMark(root.ownerDocument, id, text, id === hoveredRef.current),
			);
			observer.observe(root, {childList: true, subtree: true});
		};
		// The rendered HTML can be replaced without the markdown changing (a highlighter load), dropping the marks.
		const observer = new MutationObserver(apply);
		apply();
		return () => {
			observer.disconnect();
		};
	}, [rootRef, content, comments]);

	useLayoutEffect(() => {
		for (const mark of rootRef.current?.querySelectorAll(`mark[${PLAN_COMMENT_ID_ATTR}]`) ?? []) {
			mark.className = markClass(mark.getAttribute(PLAN_COMMENT_ID_ATTR) === hoveredId);
		}
	}, [rootRef, hoveredId]);

	useEffect(() => {
		const root = rootRef.current;
		if (root === null) return undefined;
		const edit = (mark: HTMLElement) => {
			const id = mark.getAttribute(PLAN_COMMENT_ID_ATTR);
			const comment = getPlanComments(sessionId).find((c) => c.id === id);
			const button = mark.firstElementChild;
			if (comment === undefined || button === null) return;
			document.getSelection()?.removeAllRanges();
			const range = document.createRange();
			range.selectNodeContents(button);
			setDraft(comment.comment);
			setOpen({mode: "editing", range, comment});
		};
		const onMouseOver = (event: MouseEvent) => {
			const id = markOf(event.target)?.getAttribute(PLAN_COMMENT_ID_ATTR);
			if (id !== undefined && id !== null) setHoveredId(id);
		};
		const onMouseOut = (event: MouseEvent) => {
			const mark = markOf(event.target);
			if (mark !== null && markOf(event.relatedTarget) !== mark) setHoveredId(null);
		};
		const onClick = (event: MouseEvent) => {
			const mark = markOf(event.target);
			if (mark === null) return;
			event.stopPropagation();
			edit(mark);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			const mark = markOf(event.target);
			if (mark === null) return;
			event.preventDefault();
			event.stopPropagation();
			edit(mark);
		};
		root.addEventListener("mouseover", onMouseOver);
		root.addEventListener("mouseout", onMouseOut);
		root.addEventListener("click", onClick);
		root.addEventListener("keydown", onKeyDown);
		return () => {
			root.removeEventListener("mouseover", onMouseOver);
			root.removeEventListener("mouseout", onMouseOut);
			root.removeEventListener("click", onClick);
			root.removeEventListener("keydown", onKeyDown);
		};
	}, [rootRef, content, sessionId]);

	useEffect(() => {
		const id = returnFocusRef.current;
		const root = rootRef.current;
		if (open !== null || id === null || root === null) return;
		returnFocusRef.current = null;
		const active = document.activeElement;
		if (active === null || active === document.body) markButton(root, id)?.focus();
	}, [open, rootRef]);

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
			setOpen({mode: "selection", range, ...flat});
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

	const editingId = open?.mode === "editing" ? open.comment.id : null;
	const close = useCallback(() => {
		returnFocusRef.current = editingId;
		setOpen(null);
		setDraft("");
	}, [editingId]);

	const root = rootRef.current;
	if (open === null || root === null) return null;
	const editing = open.mode === "editing" ? open.comment : null;
	return (
		<PlanCommentPopover
			key={editing === null ? `selection:${open.mode === "selection" ? open.start : 0}` : editing.id}
			range={open.range}
			selectedText={open.mode === "editing" ? open.comment.selectedText : open.text}
			boundary={root.closest<HTMLElement>("[data-plan-scroll]") ?? root}
			initialValue={opened}
			value={draft}
			onChange={setDraft}
			onSave={(comment) => {
				if (open.mode === "editing") updatePlanComment(sessionId, open.comment.id, comment);
				else
					addPlanComment(sessionId, {
						selectedText: open.text,
						startOffset: open.start,
						endOffset: open.end,
						comment,
					});
				close();
			}}
			onDelete={
				editing === null
					? undefined
					: () => {
							removePlanComment(sessionId, editing.id);
							close();
						}
			}
			onClose={close}
		/>
	);
}
