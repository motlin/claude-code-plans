import {
	type CSSProperties,
	type FocusEvent,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	DISABLED_REASON_WRAPPER_ATTR,
	FILE_REF_ATTR,
	fileRefFromElement,
	fileRefReasonId,
	renderMarkdownWithHighlighting,
	subscribeZonedTimes,
	zonedTimesVersion,
} from "../lib/client-markdown";
import type {FileRef} from "../lib/file-refs";
import {getHighlighterSync, getHighlighterVersion, subscribeHighlighter} from "../hooks/use-shiki";
import {useCodeThemes} from "../hooks/use-code-themes";
import {handleCodeCopyClick} from "../lib/code-copy";
import styles from "./markdown-article.module.css";
import {OPEN_DELAY_MS, REASON_TOOLTIP_CLASS, SIDE_CLASS} from "./ui/tooltip";
import {ViewportPortal} from "./viewport-portal";

interface FileRefProps {
	/** Inline code rendered as clickable file refs, keyed by the code's text. */
	fileRefs?: ReadonlyMap<string, FileRef> | undefined;
	/**
	 * Opens a clicked ref. A `"missing"` result means the ref re-renders as
	 * blocked; focus then moves to its wrapper if it would fall to the body.
	 */
	onFileRef?: ((ref: FileRef, element: HTMLElement) => unknown) | undefined;
	/** Artifacts-index titles keyed by artifact id, for claude.ai artifact link chips. */
	artifactTitles?: ReadonlyMap<string, string> | undefined;
	/** Curl prose quotes, as upstream does for assistant text. */
	smartQuotes?: boolean | undefined;
	/** Underline zoned clock times with the reader's local time, as upstream does for assistant text. */
	zonedTimes?: boolean | undefined;
}

type MarkdownArticleProps = FileRefProps &
	(
		| {html: string; markdown?: never; typographer?: boolean; mdLinkBase?: string | undefined}
		| {html?: never; markdown: string; typographer?: boolean; mdLinkBase?: string | undefined}
	);

function targetFileRef(event: MouseEvent | KeyboardEvent): {ref: FileRef; element: HTMLElement} | null {
	const element = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${FILE_REF_ATTR}]`) : null;
	const ref = element === null ? null : fileRefFromElement(element);
	return element === null || ref === null ? null : {ref, element};
}

interface PendingFocus {
	path: string;
	/** Which of the article's refs to this path was clicked; its blocked wrapper takes focus. */
	index: number;
}

/**
 * Upstream's `or()` focus slot: a clicked ref that turns out missing is
 * replaced by its blocked wrapper, so focus moves there (without scrolling)
 * instead of falling to the body.
 */
function useMissingRefFocus(rendered: string) {
	const article = useRef<HTMLElement>(null);
	const pending = useRef<PendingFocus | null>(null);
	useLayoutEffect(() => {
		const target = pending.current;
		if (target === null || article.current === null) return;
		const id = fileRefReasonId(target.path, "missing");
		const wrappers = [...article.current.querySelectorAll<HTMLElement>(`[${DISABLED_REASON_WRAPPER_ATTR}]`)].filter(
			(wrapper) => wrapper.getAttribute("aria-describedby") === id,
		);
		const wrapper = wrappers[target.index] ?? wrappers[0];
		if (wrapper === undefined) return;
		pending.current = null;
		const active = document.activeElement;
		if (active === null || active === document.body) wrapper.focus({preventScroll: true});
	}, [rendered]);

	function opening(ref: FileRef, element: HTMLElement, result: unknown) {
		const siblings = [...(article.current?.querySelectorAll(`[${FILE_REF_ATTR}]`) ?? [])].filter(
			(other) => other.getAttribute("data-file-path") === ref.path,
		);
		const target = {path: ref.path, index: Math.max(0, siblings.indexOf(element))};
		pending.current = target;
		void Promise.resolve(result).then((outcome) => {
			if (outcome !== "missing" && pending.current === target) pending.current = null;
		});
	}

	return {article, opening};
}

/** Whether a pointer event's other end (`relatedTarget`) lies outside `wrapper`, so the pointer crossed its edge. */
function crossesEdge(wrapper: HTMLElement, other: EventTarget | null): boolean {
	return !(other instanceof Node && wrapper.contains(other));
}

function reasonWrapperOf(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? target.closest<HTMLElement>(`[${DISABLED_REASON_WRAPPER_ATTR}]`) : null;
}

interface OpenReason {
	text: string;
	anchor: CSSProperties;
}

/**
 * The disabled-reason tooltip for blocked file refs in rendered HTML, which
 * can't hold a {@link Tooltip} element: side top, opened after the hover delay
 * or at once on focus, showing the wrapper's hidden `[data-disabled-reason]`.
 */
function useReasonTooltip() {
	const [reason, setReason] = useState<OpenReason | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () => {
			clearTimeout(timer.current);
		},
		[],
	);

	function show(wrapper: HTMLElement, delay: number) {
		clearTimeout(timer.current);
		const reveal = () => {
			const {left, top, width, height} = wrapper.getBoundingClientRect();
			const text = wrapper.querySelector("[data-disabled-reason]")?.textContent ?? "";
			setReason({text, anchor: {left, top, width, height}});
		};
		if (delay === 0) reveal();
		else timer.current = setTimeout(reveal, delay);
	}

	function hide() {
		clearTimeout(timer.current);
		setReason(null);
	}

	const handlers = {
		onPointerOver: (event: PointerEvent<HTMLElement>) => {
			const wrapper = reasonWrapperOf(event.target);
			if (wrapper !== null && crossesEdge(wrapper, event.relatedTarget)) show(wrapper, OPEN_DELAY_MS);
		},
		onPointerOut: (event: PointerEvent<HTMLElement>) => {
			const wrapper = reasonWrapperOf(event.target);
			if (wrapper !== null && crossesEdge(wrapper, event.relatedTarget)) hide();
		},
		onFocus: (event: FocusEvent<HTMLElement>) => {
			const wrapper = reasonWrapperOf(event.target);
			if (wrapper !== null) show(wrapper, 0);
		},
		onBlur: (event: FocusEvent<HTMLElement>) => {
			if (reasonWrapperOf(event.target) !== null) hide();
		},
	};

	const tooltip =
		reason === null ? null : (
			<ViewportPortal>
				<span className="pointer-events-none fixed z-[140]" style={reason.anchor}>
					<span role="tooltip" data-side="top" className={`${REASON_TOOLTIP_CLASS} ${SIDE_CLASS.top}`}>
						{reason.text}
					</span>
				</span>
			</ViewportPortal>
		);
	return {handlers, tooltip};
}

export function MarkdownArticle(props: MarkdownArticleProps) {
	const highlighterVersion = useSyncExternalStore(subscribeHighlighter, getHighlighterVersion, () => 0);
	// Re-render once the lazily loaded zoned-time parser lands, but only prose that may hold a time.
	const timesVersion = useSyncExternalStore(
		subscribeZonedTimes,
		() => zonedTimesVersion(props.markdown ?? "", props.zonedTimes ?? false),
		() => 0,
	);

	const codeThemes = useCodeThemes();

	const rendered = useMemo(() => {
		void highlighterVersion;
		void timesVersion;
		if (props.html !== undefined) return props.html;
		return renderMarkdownWithHighlighting(props.markdown, getHighlighterSync(), {
			typographer: props.typographer ?? false,
			smartQuotes: props.smartQuotes ?? false,
			zonedTimes: props.zonedTimes ?? false,
			codeThemes,
			...(props.mdLinkBase === undefined ? {} : {mdLinkBase: props.mdLinkBase}),
			...(props.fileRefs === undefined ? {} : {fileRefs: props.fileRefs}),
			...(props.artifactTitles === undefined ? {} : {artifactTitles: props.artifactTitles}),
		});
	}, [
		props.html,
		props.markdown,
		props.typographer,
		props.mdLinkBase,
		props.fileRefs,
		props.artifactTitles,
		props.smartQuotes,
		props.zonedTimes,
		codeThemes,
		highlighterVersion,
		timesVersion,
	]);

	const reasonTooltip = useReasonTooltip();
	const missingFocus = useMissingRefFocus(rendered);
	const {onFileRef} = props;
	const openRef = ({ref, element}: {ref: FileRef; element: HTMLElement}) => {
		missingFocus.opening(ref, element, onFileRef?.(ref, element));
	};
	const handleClick = (event: MouseEvent<HTMLElement>) => {
		const target = onFileRef === undefined ? null : targetFileRef(event);
		if (target === null) handleCodeCopyClick(event);
		else openRef(target);
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (onFileRef === undefined || (event.key !== "Enter" && event.key !== " ")) return;
		const target = targetFileRef(event);
		if (target === null) return;
		event.preventDefault();
		openRef(target);
	};

	return (
		<>
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- delegates clicks from the rendered links and copy buttons inside it, which are keyboard-reachable themselves */}
			<article
				ref={missingFocus.article}
				className={styles["markdown"]}
				onClick={handleClick}
				{...(onFileRef === undefined ? {} : {onKeyDown: handleKeyDown, ...reasonTooltip.handlers})}
				dangerouslySetInnerHTML={{__html: rendered}}
			/>
			{reasonTooltip.tooltip}
		</>
	);
}
