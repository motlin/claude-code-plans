import {type KeyboardEvent, type MouseEvent, useLayoutEffect, useMemo, useRef, useSyncExternalStore} from "react";
import {
	FILE_REF_ATTR,
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

interface FileRefProps {
	/** Inline code rendered as clickable file refs, keyed by the code's text. */
	fileRefs?: ReadonlyMap<string, FileRef> | undefined;
	/**
	 * Opens a clicked ref. A `"missing"` result means the ref re-renders as
	 * blocked; focus then moves to its wrapper if it would fall to the body.
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
	const {onFileRef, onFileRefDefaultApp} = props;
	const openRef = ({ref, element}: {ref: FileRef; element: HTMLElement}) => {
		missingFocus.opening(ref, element, onFileRef?.(ref, element));
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
				ref={missingFocus.article}
				className={
					props.document === true ? `${styles["markdown"]} epitaxy-document-prose` : styles["markdown"]
				}
				{...(props.document === true ? {"data-document": ""} : {})}
				onClick={handleClick}
				{...(onFileRef === undefined ? {} : {onKeyDown: handleKeyDown, ...reasonTooltip.handlers})}
				dangerouslySetInnerHTML={{__html: rendered}}
			/>
			{reasonTooltip.tooltip}
		</>
	);
}
