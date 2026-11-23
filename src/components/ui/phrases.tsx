import {useRowCut} from "../../lib/use-row-cut";

/**
 * Upstream's cds Phrases primitive (shared-9 `MG`, live 2026-11-21): each phrase is its own
 * text node in one `<bdi>`, separators leading ("Ran 2 commands", ", read a file"). Nothing
 * is measured: the bdi ellipsizes and the row-cut observer fades it while it overflows.
 */
export function Phrases({children}: {children: string | readonly string[]})
{
	const phrases = (typeof children === "string" ? [children] : children).filter((phrase) => phrase !== "");
	const ref = useRowCut(true, phrases.join(""));
	return (
		<span data-cds-phrases="" className="block min-w-0 max-w-full">
			<bdi ref={ref} className="block overflow-x-clip text-ellipsis whitespace-nowrap">
				{phrases}
			</bdi>
		</span>
	);
}
