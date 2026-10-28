import {Link} from "@tanstack/react-router";
import {ArrowLeft} from "lucide-react";
import {type MouseEvent, type ReactNode, useContext} from "react";
import {CustomizeNavContext, type CustomizeTarget, routeOptions} from "./customize-navigation";
import type {CustomizeSectionId} from "./sections";

interface CustomizeLinkProps {
	target: CustomizeTarget;
	className: string;
	children: ReactNode;
}

/** A link to a Customize target that marks itself `aria-current="page"` when it is the open place. */
export function CustomizeLink({target, className, children}: CustomizeLinkProps) {
	const navigator = useContext(CustomizeNavContext);
	if (navigator === null) {
		return (
			<Link {...routeOptions(target)} activeOptions={{exact: true, includeSearch: false}} className={className}>
				{children}
			</Link>
		);
	}
	const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
		if (!plainClick(event)) return;
		event.preventDefault();
		navigator.go(target);
	};
	return (
		<a
			href={navigator.href(target)}
			aria-current={navigator.isCurrent(target) ? "page" : undefined}
			onClick={onClick}
			className={className}
		>
			{children}
		</a>
	);
}

const BACK_LINK_CLASS =
	"-ms-2 inline-flex h-6 w-fit items-center gap-1.5 rounded-r6 px-2 text-[13px]/[19px] text-secondary no-underline hover:bg-fill-ghost-hover hover:text-primary";

function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
	return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
}

/**
 * A detail header's back link to its section list ("Your skills"), or upstream's
 * "Search" when the detail was opened from a unified search hit.
 */
export function CustomizeBackLink({section, children}: {section: CustomizeSectionId; children: ReactNode}) {
	const searchReturn = useContext(CustomizeNavContext)?.searchReturn ?? null;
	const arrow = <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />;
	if (searchReturn === null) {
		return (
			<CustomizeLink target={{kind: "list", section}} className={BACK_LINK_CLASS}>
				{arrow}
				{children}
			</CustomizeLink>
		);
	}
	return (
		<a
			href={searchReturn.href}
			onClick={(event) => {
				if (!plainClick(event)) return;
				event.preventDefault();
				searchReturn.go();
			}}
			className={BACK_LINK_CLASS}
		>
			{arrow}
			Search
		</a>
	);
}
