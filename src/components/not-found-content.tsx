import {Link} from "@tanstack/react-router";

import {Spark} from "./spark";

/**
 * Upstream's 404 grid: the spark and wordmark, an h2 "Page not found", its h3 line and Go back home.
 * Upstream's `h-screen` sits in a bare scroller; here the page sits under RootTopRow (36px, 48px
 * below sm) and the gutter's bottom padding (32px, 96px below sm). Subtracting 72px on desktop (not
 * 68px) centres the stack on upstream's line: at 1680x916 the heading lands at y=423 vs upstream's 422.
 */
export function NotFoundContent({detail}: Readonly<{detail?: string}>) {
	return (
		<div
			data-not-found=""
			className="mx-auto grid h-[calc(100dvh-4.5rem)] min-h-min w-fit max-w-2xl place-content-center gap-2 px-4 pt-24 pb-32 text-center max-sm:h-[calc(100dvh-9rem)]"
		>
			<div className="mb-10 text-center">
				<span
					role="img"
					aria-label="Claude Code Browser"
					className="inline-flex items-center gap-1.5 align-top font-voice text-[20px] leading-none font-medium whitespace-nowrap text-primary"
				>
					<Spark size={24} />
					<span aria-hidden="true">Claude Code Browser</span>
				</span>
			</div>
			<h2 className="font-voice text-[20px]/[28px] font-normal text-balance text-primary">Page not found</h2>
			<h3 className="text-[14px]/[18px] font-normal text-balance text-secondary">
				Claude can help with many things, but finding this page isn’t one of them.
			</h3>
			{detail ? <pre className="max-w-2xl overflow-auto font-mono text-xs text-t6">{detail}</pre> : null}
			<div className="mx-0 mt-4 min-w-[16rem]">
				<Link
					to="/"
					className="inline-flex h-6 items-center rounded-r5 bg-fill-primary px-2 text-[13px]/[19px] font-medium text-on-primary no-underline outline-none transition-shadow hover:bg-fill-primary-hover focus-visible:shadow-focus"
				>
					Go back home
				</Link>
			</div>
		</div>
	);
}
