import {useFizzyLake} from "../../lib/fizzy-lake";
import {useRowCut} from "../../lib/use-row-cut";

/**
 * Upstream's cds Phrases primitive (shared-9 `MG`): each phrase is its own text node in one
 * `<bdi>`, separators leading ("Ran 2 commands", ", read a file").
 *
 * Under fizzy-lake `type` (upstream `MM("type")`, on for the live account) nothing is
 * measured: the bdi ellipsizes and the row-cut observer fades it while it overflows
 * (cds-type-experiment-gate T3). With `type` off, several phrases render upstream's "…"
 * probe for the phrase-boundary measurer (turn-status-phrase-clip T2), which has not
 * landed, so that path still clips by CSS alone.
 */
export function Phrases({children}: {children: string | readonly string[]}) {
	const phrases = (typeof children === "string" ? [children] : children).filter((phrase) => phrase !== "");
	const type = useFizzyLake("type");
	const measures = phrases.length > 1 && !type;
	const ref = useRowCut(type, phrases.join(""));
	return (
		<span data-cds-phrases="all" className="relative block min-w-0 max-w-full">
			<bdi
				ref={ref}
				className={
					measures
						? "block overflow-x-clip whitespace-nowrap"
						: "block overflow-x-clip whitespace-nowrap text-ellipsis"
				}
			>
				{phrases}
			</bdi>
			{measures && <span aria-hidden="true" className="invisible absolute start-0 top-0 after:content-['…']" />}
		</span>
	);
}
