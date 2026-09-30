import {useQuery} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {localAccountQueryOptions} from "../../lib/api/local-account";
import {HomeGreeting} from "./greeting";

const COLUMN = "mx-auto w-full max-w-[840px] pr-10 pl-8";

/**
 * Upstream's /code landing shell: a greeting header, a scrolling body, and a bottom dock, all in
 * an 840px centered column with 32px/40px gutters.
 */
export function HomePage({
	children,
	dock,
	clear = false,
}: Readonly<{children?: ReactNode; dock?: ReactNode; clear?: boolean}>) {
	const {data: account} = useQuery(localAccountQueryOptions);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="mx-auto flex w-full max-w-[840px] items-center gap-1.5 pt-3 pr-10 pb-6 pl-8">
				<HomeGreeting name={account?.firstName} clear={clear} />
			</header>
			<div data-home-body className={`min-h-0 flex-1 overflow-y-auto ${COLUMN}`}>
				{children}
			</div>
			{dock === undefined ? null : <div className={`shrink-0 ${COLUMN}`}>{dock}</div>}
		</div>
	);
}
