import {lazy, Suspense, useSyncExternalStore} from "react";
import {handleCodeCopyClick} from "../lib/code-copy";
import {
	mermaidLoadFailed,
	mermaidSourceDrawable,
	noteMermaidLoadFailed,
	subscribeMermaidLoad,
} from "../lib/mermaid-gate";
import {RenderErrorBoundary} from "./render-error-boundary";
import {Skeleton} from "./ui/skeleton";

/**
 * Upstream's `code_mermaid_fence` lazy entry: the fence, its renderer, the sanitizer and the theme load on the
 * first diagram. A chunk that fails to load turns diagrams off for the page, as upstream's recovery handle does.
 */
const LazyMermaidFence = lazy(async () =>
	import("./mermaid-fence").then(
		(module) => ({default: module.MermaidFence}),
		(error: unknown) => {
			noteMermaidLoadFailed();
			throw error;
		},
	),
);

/** Upstream `dn`: the stand-in while the diagram code loads and the first draw runs. */
export function MermaidPlaceholder() {
	return (
		<div data-testid="epitaxy-mermaid-fence-placeholder">
			<div className="rounded-[var(--msg-block-radius,0.5rem)] border-0.5 border p-4">
				<Skeleton className="h-[88px] w-full rounded-md" />
			</div>
		</div>
	);
}

/** The fence's ordinary code block, from the markdown render; its copy button works through the delegated handler. */
function CodeBlock({html}: {html: string}) {
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegates clicks from the copy button inside it, which is keyboard-reachable itself
		<div className="contents" onClick={handleCodeCopyClick} dangerouslySetInnerHTML={{__html: html}} />
	);
}

function reportFenceCrash(error: unknown) {
	console.error("[mermaid-fence]", error);
}

/**
 * Upstream's `Cn`: a mermaid fence in the diagram context. It stays the code block when mermaid cannot load or the
 * source is not drawable; otherwise it loads the fence lazily, with the placeholder meanwhile and the code block as
 * the crash fallback (upstream's `EpitaxyMermaidFence` boundary, reset by the code).
 */
export function MermaidFenceGate({code, codeBlockHtml}: {code: string; codeBlockHtml: string}) {
	const failed = useSyncExternalStore(subscribeMermaidLoad, mermaidLoadFailed, () => false);
	const codeBlock = <CodeBlock html={codeBlockHtml} />;
	if (failed || !mermaidSourceDrawable(code)) return codeBlock;
	const placeholder = <MermaidPlaceholder />;
	return (
		<RenderErrorBoundary resetOn={code} fallback={codeBlock} report={reportFenceCrash}>
			<Suspense fallback={placeholder}>
				<LazyMermaidFence code={code} codeBlock={codeBlock} placeholder={placeholder} />
			</Suspense>
		</RenderErrorBoundary>
	);
}
