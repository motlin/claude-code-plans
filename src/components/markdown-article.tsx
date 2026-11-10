import {
	type FocusEvent,
	type KeyboardEvent,
	type MouseEvent,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {createPortal} from "react-dom";
import {
	FILE_REF_ATTR,
	MERMAID_FENCE_ATTR,
	MERMAID_SOURCE_ATTR,
	fileRefFromElement,
	renderMarkdownWithHighlighting,
	subscribeZonedTimes,
	zonedTimesVersion,
} from "../lib/client-markdown";
import {DISABLED_REASON_WRAPPER_ATTR, type FileRef, fileRefReasonId} from "../lib/file-refs";
import {getHighlighterSync, getHighlighterVersion, subscribeHighlighter} from "../hooks/use-shiki";
import {useCodeThemes} from "../hooks/use-code-themes";
import {handleCodeCopyClick} from "../lib/code-copy";
import styles from "./markdown-article.module.css";
import {useReasonTooltip} from "./use-reason-tooltip";
import {MermaidFenceGate} from "./mermaid-fence-gate";

interface FileRefProps {
	/** Inline code rendered as clickable file refs, keyed by the code's text. */
	fileRefs?: ReadonlyMap<string, FileRef> | undefined;
	/**
	 * Opens a clicked ref. A ref found missing re-renders as blocked; if it held
	 * focus, focus then moves to its wrapper instead of falling to the body.
	 */
	onFileRef?: ((ref: FileRef, element: HTMLElement) => unknown) | undefined;
	/** Handles a ⌘/Ctrl-click on a ref instead of `onFileRef`; true when it opened the ref. */
	onFileRefDefaultApp?: ((ref: FileRef) => boolean) | undefined;
	/** Artifacts-index titles keyed by artifact id, for claude.ai artifact link chips. */
	artifactTitles?: ReadonlyMap<string, string> | undefined;
	/** Curl prose quotes, as upstream does for assistant text. */
	smartQuotes?: boolean | undefined;
	/** Underline zoned clock times with the reader's local time, as upstream does for assistant text. */
	zonedTimes?: boolean | undefined;
	/**
	 * Upstream's "document" markdown mode (the Plan pane), which skips
	 * remark-breaks: soft line breaks wrap as spaces instead of breaking lines.
	 */
	document?: boolean | undefined;
	/**
	 * Upstream's "diagram" markdown context (assistant transcript text): mermaid fences draw as diagrams
	 * instead of code blocks.
	 */
	diagrams?: boolean | undefined;
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

interface FocusedRef {
	path: string;
	/** Which of the article's refs to this path holds focus; its missing wrapper takes focus over. */
	index: number;
}

/** The article's file-ref links to one path, in document order. */
function refsToPath(article: HTMLElement, path: string): HTMLElement[] {
	return [...article.querySelectorAll<HTMLElement>(`[${FILE_REF_ATTR}]`)].filter(
		(element) => element.getAttribute("data-file-path") === path,
	);
}

/**
 * Upstream's file-link focus slot (`or()`) for rendered HTML: a focused ref
 * replaced by its `missing` wrapper (the one holding the hidden focus-slot
 * span) hands focus to that wrapper, without scrolling, instead of letting it
 * fall to the body. Focus is tracked as it enters and leaves the refs, since
 * a re-render replaces the focused element before any effect sees it.
 */
function useProseFocusSlot(rendered: string) {
	const article = useRef<HTMLElement>(null);
	const focused = useRef<FocusedRef | null>(null);
	useLayoutEffect(() => {
		const target = focused.current;
		if (target === null || article.current === null) return;
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		focused.current = null;
		const id = fileRefReasonId(target.path, "missing");
		const wrappers = [
			...article.current.querySelectorAll<HTMLElement>(
				`[${DISABLED_REASON_WRAPPER_ATTR}][aria-describedby="${id}"]`,
			),
		].filter((wrapper) => wrapper.querySelector(":scope > span[hidden]:not([id])") !== null);
		(wrappers[target.index] ?? wrappers[0])?.focus({preventScroll: true});
	}, [rendered]);

	const handlers = {
		onFocus: (event: FocusEvent<HTMLElement>) => {
			const element =
				event.target instanceof Element ? event.target.closest<HTMLElement>(`[${FILE_REF_ATTR}]`) : null;
			const path = element?.getAttribute("data-file-path") ?? null;
			focused.current =
				element === null || path === null || article.current === null
					? null
					: {path, index: Math.max(0, refsToPath(article.current, path).indexOf(element))};
		},
		onBlur: (event: FocusEvent<HTMLElement>) => {
			// Focus moving to another element forgets the ref; focus dropped by its removal keeps it.
			if (event.relatedTarget !== null) focused.current = null;
		},
	};

	return {article, handlers};
}

interface MermaidIsland {
	element: HTMLElement;
	code: string;
	codeBlockHtml: string;
}

/** The code block HTML each placeholder held before its island took it over (kept for a re-run effect). */
const islandCodeBlocks = new WeakMap<HTMLElement, string>();

/**
 * The mermaid fences in the rendered HTML, each taken over by a React island: its placeholder is emptied and the
 * island renders the diagram fence (and its code block) into it through a portal.
 */
function useMermaidIslands(article: {readonly current: HTMLElement | null}, rendered: string, diagrams: boolean) {
	const [islands, setIslands] = useState<MermaidIsland[]>([]);
	useLayoutEffect(() => {
		const found =
			!diagrams || article.current === null
				? []
				: [...article.current.querySelectorAll<HTMLElement>(`[${MERMAID_FENCE_ATTR}]`)].map((element) => {
						const codeBlockHtml = islandCodeBlocks.get(element) ?? element.innerHTML;
						islandCodeBlocks.set(element, codeBlockHtml);
						element.replaceChildren();
						return {element, code: element.getAttribute(MERMAID_SOURCE_ATTR) ?? "", codeBlockHtml};
					});
		setIslands((previous) => (previous.length === 0 && found.length === 0 ? previous : found));
	}, [article, rendered, diagrams]);
	return islands.map((island) =>
		createPortal(
			<MermaidFenceGate code={island.code} codeBlockHtml={island.codeBlockHtml} />,
			island.element,
			island.element.getAttribute(MERMAID_FENCE_ATTR),
		),
	);
}

/** Upstream `EM`: prose whose markdown render crashed, drawn as its raw text inside the same prose wrapper. */
export function PlainTextArticle({text}: {text: string}) {
	return (
		<article className={styles["markdown"]}>
			<div className="whitespace-pre-wrap">{text}</div>
		</article>
	);
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
			diagrams: props.diagrams ?? false,
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
		props.diagrams,
		codeThemes,
		highlighterVersion,
		timesVersion,
	]);

	const reasonTooltip = useReasonTooltip();
	const focusSlot = useProseFocusSlot(rendered);
	const islands = useMermaidIslands(focusSlot.article, rendered, props.diagrams ?? false);
	const {onFileRef, onFileRefDefaultApp} = props;
	const openRef = ({ref, element}: {ref: FileRef; element: HTMLElement}) => {
		onFileRef?.(ref, element);
	};
	const handleClick = (event: MouseEvent<HTMLElement>) => {
		const target = onFileRef === undefined ? null : targetFileRef(event);
		if (target === null) handleCodeCopyClick(event);
		else if (!((event.metaKey || event.ctrlKey) && onFileRefDefaultApp?.(target.ref) === true)) openRef(target);
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
				ref={focusSlot.article}
				className={
					props.document === true ? `${styles["markdown"]} epitaxy-document-prose` : styles["markdown"]
				}
				{...(props.document === true ? {"data-document": ""} : {})}
				onClick={handleClick}
				{...(onFileRef === undefined
					? {}
					: {
							onKeyDown: handleKeyDown,
							...reasonTooltip.handlers,
							onFocus: (event: FocusEvent<HTMLElement>) => {
								focusSlot.handlers.onFocus(event);
								reasonTooltip.handlers.onFocus(event);
							},
							onBlur: (event: FocusEvent<HTMLElement>) => {
								focusSlot.handlers.onBlur(event);
								reasonTooltip.handlers.onBlur(event);
							},
						})}
				dangerouslySetInnerHTML={{__html: rendered}}
			/>
			{islands}
			{reasonTooltip.tooltip}
		</>
	);
}
