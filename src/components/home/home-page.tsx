import {useQuery} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {localAccountQueryOptions} from "../../lib/api/local-account";
import {HomeGreeting} from "./greeting";
import {HOME_COLUMN} from "./home-column";

/**
 * Upstream's /code landing shell: a greeting header, a scrolling body, and a bottom dock, all in
 * an 840px centered column with 32px/40px gutters (25px on a phone).
 */
export function HomePage({
	children,
	dock,
	clear = false,
}: Readonly<{children?: ReactNode; dock?: ReactNode; clear?: boolean}>) {
	const {data: account} = useQuery(localAccountQueryOptions);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className={`flex items-center gap-1.5 pt-3 pb-6 ${HOME_COLUMN}`}>
				<HomeGreeting name={account?.firstName} clear={clear} />
			</header>
			<div className={`flex min-h-0 flex-1 flex-col ${HOME_COLUMN}`}>
				<div
					data-home-body
					data-scroll-restoration-id="main"
					className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
				>
					{children}
				</div>
			</div>
			{dock === undefined ? null : <div className={`shrink-0 ${HOME_COLUMN}`}>{dock}</div>}
		</div>
	);
}
