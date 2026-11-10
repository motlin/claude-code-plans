import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from "react";
import {
	MERMAID_DRAW_LIMIT_MS,
	MERMAID_SHADOW_STYLE,
	MERMAID_SHADOW_STYLE_AUTO_DIRECTION,
	asMermaidRefusal,
	cachedDiagram,
	drawMermaid,
	drawnKey,
	loadMermaidWithGuard,
	mermaidGuardLoaded,
	mermaidScopeId,
	refusalFor,
	rememberDrawn,
	rememberRefusal,
	rememberedRefusal,
	sanitizeMermaidSvg,
	touchDrawn,
	writeShadowSvg,
} from "../lib/mermaid-render";
import {type MermaidThemeMode, themeFor} from "../lib/mermaid-theme";

export type MermaidStatus = "loading" | "success" | "error";

type DiagramState =
	| {status: "loading"}
	| {status: "success"; key: string; svg: string; scopeId: string; width: number}
	| {status: "error"; cause: "refused" | "load" | "render"};

/** Upstream `GY`. */
const REFUSED: DiagramState = {status: "error", cause: "refused"};

/**
 * Upstream's block shape, whose border and background use claude.ai's legacy numeric palette (border 400, background
 * 000 at 50%). That palette is retired locally, so the classes name the tokens it stands for: the border token, and
 * surface-3 (upstream's fizzy remap gives its background-000 class the surface-3 rule).
 */
const BLOCK_SHAPE = "rounded-[var(--msg-block-radius,0.5rem)] border-0.5 border-border bg-surface-3/50";

/**
 * Upstream's markdown mermaid renderer (shared-41 `x2`): draws `code` through the serialized sandboxed queue into
 * a shadow root, reusing a cached drawing on remount, and shows the source in a `<pre>` when the draw fails.
 * Upstream's streaming context (`_A`) has no local twin: transcript text blocks arrive whole.
 */
export function MermaidDiagram({
	code,
	mode,
	autoLabelDirection = false,
	onStatusChange,
}: {
	code: string;
	mode: MermaidThemeMode;
	autoLabelDirection?: boolean;
	onStatusChange?: ((status: MermaidStatus) => void) | undefined;
}) {
	const scopeId = mermaidScopeId(useId());
	const key = drawnKey(mode, code);
	const cached = useMemo(() => cachedDiagram(key, `${scopeId}-c`), [key, scopeId]);
	const refusal = refusalFor(code);
	const [state, setState] = useState<DiagramState>(() =>
		cached ? {status: "success", key, ...cached} : refusal === undefined ? {status: "loading"} : REFUSED,
	);
	if (cached && (state.status !== "success" || state.svg !== cached.svg))
		setState({status: "success", key, ...cached});
	const knownRefusal = state.status === "success" && state.key === key ? undefined : refusal;
	const shown = useMemo<DiagramState>(
		() => (cached ? {status: "success", key, ...cached} : knownRefusal === undefined ? state : REFUSED),
		[cached, key, knownRefusal, state],
	);
	const status = shown.status;
	useEffect(() => {
		onStatusChange?.(status);
	}, [onStatusChange, status]);

	// A drawing is cached when its fence unmounts, so scrolling back to it redraws nothing.
	const latest = useRef(shown);
	useEffect(() => {
		latest.current = shown;
	}, [shown]);
	useEffect(
		() => () => {
			const last = latest.current;
			if (last.status === "success")
				rememberDrawn(last.key, {svg: last.svg, scopeId: last.scopeId, width: last.width});
		},
		[],
	);

	useEffect(() => {
		if (cached) {
			touchDrawn(key);
			return undefined;
		}
		if (refusal !== undefined) return undefined;
		const controller = new AbortController();
		void (async () => {
			let loaded = false;
			try {
				const mermaid = await loadMermaidWithGuard();
				loaded = true;
				const result = await drawMermaid(
					mermaid,
					{
						startOnLoad: false,
						htmlLabels: false,
						maxTextSize: 20_000,
						maxEdges: 400,
						fontFamily: "inherit",
						theme: "base",
						...themeFor(mode),
					},
					scopeId,
					code,
					{signal: controller.signal, limitMs: MERMAID_DRAW_LIMIT_MS, dimUnreadableBands: true},
				);
				if (controller.signal.aborted) return;
				setState({
					status: "success",
					svg: sanitizeMermaidSvg(result.svg, result.diagramId),
					key,
					scopeId: result.diagramId,
					width: window.innerWidth,
				});
			} catch (error) {
				// A refusal the guard will refuse again is remembered, so a remount does not draw it again.
				const refusal = asMermaidRefusal(error);
				if (refusal?.refusedBy !== undefined && rememberedRefusal(refusal))
					rememberRefusal(code, refusal.refusedBy);
				if (controller.signal.aborted) return;
				const drew = loaded && mermaidGuardLoaded();
				setState(
					refusal?.refusedBy === undefined ? {status: "error", cause: drew ? "render" : "load"} : REFUSED,
				);
				if (refusal?.refusedBy !== undefined) {
					console.info(`Mermaid diagram in markdown ${refusal.message}`);
					return;
				}
				const name =
					error instanceof Error
						? (/^\w{1,64}$/.exec(error.name)?.[0] ?? "Error")
						: `a non-Error ${typeof error}`;
				console.warn(
					`Failed to render mermaid diagram in markdown: ${drew ? "drawing" : "loading mermaid, its limits or its theme"} threw ${name}`,
				);
			}
		})();
		return () => {
			controller.abort();
		};
	}, [cached, refusal, key, code, mode, scopeId]);

	const host = useRef<HTMLDivElement>(null);
	const svg = shown.status === "success" ? shown.svg : undefined;
	const failed = shown.status === "error";
	useLayoutEffect(() => {
		const element = host.current;
		if (!element || (svg === undefined && !element.shadowRoot)) return;
		writeShadowSvg(
			element,
			svg ?? "",
			autoLabelDirection ? MERMAID_SHADOW_STYLE_AUTO_DIRECTION : MERMAID_SHADOW_STYLE,
		);
	}, [svg, failed, autoLabelDirection]);

	if (failed)
		return (
			<pre
				dir="ltr"
				data-mermaid
				className={`overflow-x-auto whitespace-pre ${BLOCK_SHAPE} p-3.5 font-mono-ui text-sm`}
			>
				{code}
			</pre>
		);
	return (
		<div
			ref={host}
			dir="ltr"
			data-mermaid
			role="img"
			aria-label="Mermaid diagram"
			className={`relative [contain:paint] overflow-x-auto ${BLOCK_SHAPE} p-4${shown.status === "loading" ? " min-h-24 animate-pulse" : ""}`}
		/>
	);
}
