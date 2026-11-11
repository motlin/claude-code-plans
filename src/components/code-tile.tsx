import {lazy, type ReactNode, Suspense} from "react";
import {useCodeThemeBackground} from "../hooks/use-code-theme-background";
import {normalizeTileCode} from "../lib/code-tile";

const CodeTileFile = lazy(async () => import("./code-tile-file").then((module) => ({default: module.CodeTileFile})));

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
	prose = false,
}: {
	code: string;
	lang: string;
	leading?: ReactNode;
	action?: ReactNode;
	prose?: boolean;
}) {
	const background = useCodeThemeBackground();
	const held = <span className="whitespace-pre-wrap break-words">{normalizeTileCode(code)}</span>;
	return (
		<div
			dir={prose ? undefined : "ltr"}
			className="epitaxy-diff epitaxy-code-card rounded-lg flex overflow-clip px-md py-xs text-code"
			style={{background}}
		>
			{leading}
			<div className="min-w-0 flex-1">
				<Suspense fallback={held}>
					<CodeTileFile code={code} lang={lang} />
				</Suspense>
			</div>
			{action ? <div className="flex h-[1lh] shrink-0 items-center">{action}</div> : null}
		</div>
	);
}

/** Upstream `tl`: a command in the code tile behind a `$ ` prompt gutter (`> ` for PowerShell). */
export function CommandCodeTile({
	command,
	lang = "bash",
	action,
}: {
	command: string;
	lang?: string;
	action?: ReactNode;
}) {
	const leading = (
		<span aria-hidden="true" data-find-omitted="" className="select-none text-secondary">
			{lang === "powershell" ? ">" : "$"}
			{" "}
		</span>
	);
	return <CodeTile code={command} lang={lang} leading={leading} action={action} />;
}
