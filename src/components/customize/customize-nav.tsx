import {Link} from "@tanstack/react-router";
import {type MouseEvent, type ReactNode, useContext} from "react";
import {CustomizeNavContext, type CustomizeTarget, routeOptions} from "./customize-navigation";

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
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
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
