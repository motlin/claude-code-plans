import
{
	lazy,
	type ReactNode,
	type RefObject,
	Suspense,
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useRef,
	useSyncExternalStore,
} from "react";
import {handleCodeCopyClick} from "../lib/code-copy";
import
{
	FindEnabledContext,
	MermaidBlockIdContext,
	mermaidSourceKey,
	MermaidSourceStoreContext,
} from "../lib/mermaid-find";
import
{
	mermaidLoadFailed,
	mermaidSourceDrawable,
	noteMermaidLoadFailed,
	subscribeMermaidLoad,
} from "../lib/mermaid-gate";
import {RenderErrorBoundary} from "./render-error-boundary";
import {Skeleton, SkeletonGroup} from "./ui/skeleton";

/**
 * Upstream's `code_mermaid_fence` lazy entry: the fence, its renderer, the sanitizer and the theme load on the
 * first diagram. A chunk that fails to load turns diagrams off for the page, as upstream's recovery handle does.
 */
const LazyMermaidFence = lazy(async () =>
	import("./mermaid-fence").then(
		(module) => (
		{
			default: module.MermaidFence,
		}),
		(error: unknown) =>
		{
			noteMermaidLoadFailed();
			throw error;
		},
	),
);

/** Upstream `dn`: the stand-in while the diagram code loads and the first draw runs. */
export function MermaidPlaceholder()
{
	return (
		<div data-testid="epitaxy-mermaid-fence-placeholder">
			<SkeletonGroup hold="delayed" status>
				<div className="rounded-[var(--msg-block-radius,0.5rem)] border-0.5 border p-4">
					<Skeleton decorative className="h-[88px] w-full rounded-md" />
				</div>
			</SkeletonGroup>
		</div>
	);
}

/** The fence's ordinary code block, from the markdown render; its copy button works through the delegated handler. */
function CodeBlock({html}: {html: string})
{
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegates clicks from the copy button inside it, which is keyboard-reachable itself
		<div
			className="contents"
			onClick={handleCodeCopyClick}
			dangerouslySetInnerHTML={
			{
				__html: html,
			}}
		/>
	);
}

/** Upstream `bn`: the virtualized row a fence sits in (the transcript's entry rows here). */
const ROW_SELECTOR = "[data-transcript-entry-index]";

interface SourceReporter
{
	report: (visible: boolean) => void;
	ref: RefObject<HTMLDivElement | null>;
}

/**
 * Upstream `xn`: reports `visible` for the fence's source, and hidden once it unmounts, unless its whole row unmounted
 * (a virtualized row scrolling away keeps what it last reported, so the count stays put).
 */
function useReportSource({report, ref}: SourceReporter, visible: boolean)
{
	useEffect(() =>
	{
		report(visible);
	}, [report, visible]);
	const hide = useEffectEvent(() =>
	{
		report(false);
	});
	useEffect(() =>
	{
		const row = ref.current?.closest(ROW_SELECTOR) ?? null;
		return () =>
		{
			if (row === null || row.isConnected) hide();
		};
	}, [ref]);
}

/** Upstream `Tn`: the fence's source, findable (`data-find-included`) and reported visible while find is enabled. */
function FindableSource({reporter, children}: {reporter: SourceReporter; children: ReactNode})
{
	const find = useContext(FindEnabledContext);
	useReportSource(reporter, find);
	return (
		<div
			className="contents"
			{...(find
				?
					{
						"data-find-included": "",
					}
				: {})}
		>
			{children}
		</div>
	);
}

/** Upstream `En`: the placeholder, keeping whatever visibility the source last reported. */
function ReportingPlaceholder({reporter, reported}: {reporter: SourceReporter; reported: boolean})
{
	useReportSource(reporter, reported);
	return <MermaidPlaceholder />;
}

function reportFenceCrash(error: unknown)
{
	console.error("[mermaid-fence]", error);
}

/**
 * Upstream's `Cn`/`Dn`: a mermaid fence in the diagram context. It stays the code block when mermaid cannot load or
 * the source is not drawable; otherwise it loads the fence lazily, with the placeholder meanwhile and the code block
 * as the crash fallback (upstream's `EpitaxyMermaidFence` boundary, reset by the code). While in-page find is enabled
 * the fence is omitted from the find walk, and its source copy is included and reported visible to the transcript's
 * store under the block id and code, so the search text counts the source only while it shows.
 */
export function MermaidFenceGate({code, codeBlockHtml}: {code: string; codeBlockHtml: string})
{
	const failed = useSyncExternalStore(subscribeMermaidLoad, mermaidLoadFailed, () => false);
	const find = useContext(FindEnabledContext);
	const store = useContext(MermaidSourceStoreContext);
	const key = mermaidSourceKey(useContext(MermaidBlockIdContext), code);
	const report = useCallback(
		(visible: boolean) =>
		{
			store.getState().setMermaidSourceVisible(key, visible);
		},
		[store, key],
	);
	const reported = useSyncExternalStore(
		store.subscribe,
		() => store.getState().isMermaidSourceVisible(key),
		() => false,
	);
	const ref = useRef<HTMLDivElement>(null);
	const codeBlock = <CodeBlock html={codeBlockHtml} />;
	if (failed || !mermaidSourceDrawable(code)) return codeBlock;
	const reporter: SourceReporter =
	{
		report,
		ref,
	};
	const placeholder = <ReportingPlaceholder reporter={reporter} reported={reported} />;
	const source = <FindableSource reporter={reporter}>{codeBlock}</FindableSource>;
	return (
		<div
			ref={ref}
			{...(find
				?
					{
						"data-find-omitted": "",
					}
				: {})}
		>
			<RenderErrorBoundary resetOn={code} fallback={source} report={reportFenceCrash}>
				<Suspense fallback={placeholder}>
					<LazyMermaidFence code={code} codeBlock={source} placeholder={placeholder} />
				</Suspense>
			</RenderErrorBoundary>
		</div>
	);
}
