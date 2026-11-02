import {useState} from "react";

import {maskSecretValue, type SecretMatch, secretLabel} from "../lib/secret-mask";
import {Icon} from "./ui/icon";

/** The cloak's reveal button from upstream cb557955f `y` (its 3px radius as `rounded-r2`), as client-markdown's cloak draws it. */
const CLOAK_BUTTON_CLASS =
	"inline-flex shrink-0 translate-y-[1px] items-center justify-center rounded-r2 text-secondary focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus hover:text-primary";

/**
 * Upstream cb557955f `y`: a secret drawn masked, announced as "Redacted <kind>", with its own Eye button that
 * shows and hides the raw value. The React twin of client-markdown's `secretCloakHtml`.
 */
export function SecretCloak({match}: {match: Pick<SecretMatch, "value" | "patternId" | "keep">})
{
	const [revealed, setRevealed] = useState(false);
	const label = secretLabel(match.patternId);
	return (
		<span data-redacted-secret="" className="inline-flex max-w-full items-baseline gap-[2px] align-baseline">
			<span className="break-all">
				{revealed ? (
					match.value
				) : (
					<>
						<span data-find-omitted="" className="sr-only select-none">
							Redacted {label}
						</span>
						<span aria-hidden="true">{maskSecretValue(match.value, match.keep)}</span>
					</>
				)}
			</span>
			<button
				type="button"
				aria-pressed={revealed}
				aria-label={`${revealed ? "Hide" : "Reveal"} ${label}`}
				onClick={(event) =>
				{
					event.stopPropagation();
					setRevealed((shown) => !shown);
				}}
				className={CLOAK_BUTTON_CLASS}
			>
				<Icon name={revealed ? "EyeSlash" : "Eye"} size="xs" />
			</button>
		</span>
	);
}
