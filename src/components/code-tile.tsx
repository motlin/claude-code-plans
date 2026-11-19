import {lazy, type ReactNode, Suspense} from "react";
import {useCodeThemeBackground} from "../hooks/use-code-theme-background";
import {normalizeTileCode} from "../lib/code-tile";

const CodeTileFile = lazy(async () =>
	import("./code-tile-file").then((module) => (
	{
		default: module.CodeTileFile,
	})),
);

/**
 * Upstream `el`: a headerless, unnumbered, wrapping pierre `File` on the code theme's background, with an
 * optional `leading` element before it and an `action` after it. Always left-to-right unless `prose`.
 * Until pierre loads, the plain normalized text holds the File's place (upstream `held`).
 */
export function CodeTile({
	code,
	lang,
	leading,
	action,
	codeFrame,
	prose = false,
}: {
	code: string;
	lang: string;
	leading?: ReactNode;
	action?: ReactNode;
	/** Wraps the File column's contents, as upstream's `codeFrame` (the Bash card's long-command scroller). */
	codeFrame?: ((file: ReactNode) => ReactNode) | undefined;
	prose?: boolean;
})
{
	const background = useCodeThemeBackground();
	const held = <span className="whitespace-pre-wrap break-words">{normalizeTileCode(code)}</span>;
	const file = (
		<Suspense fallback={held}>
			<CodeTileFile code={code} lang={lang} />
		</Suspense>
	);
	return (
		<div
			dir={prose ? undefined : "ltr"}
			className="epitaxy-diff epitaxy-code-card rounded-lg flex overflow-clip px-md py-xs text-code"
			style={
			{
				background,
			}}
		>
			{leading}
			<div className="min-w-0 flex-1">{codeFrame ? codeFrame(file) : file}</div>
			{action ? <div className="flex h-[1lh] shrink-0 items-center">{action}</div> : null}
		</div>
	);
}

/** Upstream `_v`'s scroll region: a keyboard-focusable "Command" group. */
const COMMAND_FRAME_REGION =
{
	tabIndex: 0,
	role: "group",
	"aria-label": "Command",
} as const;

/**
 * Upstream `_v` (`Z slot="bash-command"`): a keyboard-focusable "Command" group that scrolls a long command
 * inside 10.5 code lines (upstream `max-h-[calc(var(--cds-leading-code)*10.5)]`, on CODE_TILE_CSS's leading).
 */
export function CommandFrame({children}: {children: ReactNode})
{
	return (
		<div
			{...COMMAND_FRAME_REGION}
			className="max-h-[calc(var(--code-leading,var(--upstream-leading-code))*10.5)] overflow-y-auto"
		>
			{children}
		</div>
	);
}

/** Upstream `tl`: a command in the code tile behind a `$ ` prompt gutter (`> ` for PowerShell). */
export function CommandCodeTile({
	command,
	lang = "bash",
	action,
	codeFrame,
}: {
	command: string;
	lang?: string;
	action?: ReactNode;
	codeFrame?: ((file: ReactNode) => ReactNode) | undefined;
})
{
	const leading = (
		<span aria-hidden="true" data-find-omitted="" className="select-none text-secondary">
			{lang === "powershell" ? ">" : "$"}
			{" "}
		</span>
	);
	return <CodeTile code={command} lang={lang} leading={leading} action={action} codeFrame={codeFrame} />;
}
