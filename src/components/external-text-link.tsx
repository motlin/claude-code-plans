import {type ComponentProps, useId} from "react";

/**
 * Upstream cds `bg`: the "(opens in new tab)" hint for an external TextLink. It is `hidden`, so it never joins the
 * link's accessible name; the link references it through `aria-describedby`, making it the accessible description.
 */
export function ExternalLinkHint({id}: {id: string})
{
	return (
		<span id={id} hidden className="sr-only">
			(opens in new tab)
		</span>
	);
}

type ExternalTextLinkProps = ComponentProps<"a"> &
{
	href: string;
};

/**
 * Upstream cds `TextLink` with `external`: opens in a new tab and appends the hidden hint as the last child, with its
 * id appended after any caller `aria-describedby` ids. `rel` is the caller's (upstream `mU`: `noopener` for
 * Anthropic-family hosts, `noopener noreferrer` otherwise).
 */
export function ExternalTextLink({
	children,
	className = "cds-reset text-link inline cursor-pointer",
	"aria-describedby": describedBy,
	...rest
}: ExternalTextLinkProps)
{
	const id = useId();
	return (
		<a
			data-cds="TextLink"
			target="_blank"
			{...rest}
			className={className}
			aria-describedby={[describedBy, id].filter(Boolean).join(" ")}
		>
			{children}
			<ExternalLinkHint id={id} />
		</a>
	);
}
