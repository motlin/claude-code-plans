import {useNavigate} from "@tanstack/react-router";
import type {ReactNode} from "react";
import {requestHomeComposerFocus} from "../lib/home-composer-focus";

/** Upstream's default-density sm primary Button: h-control--sm 20, pad-md--sm 6, radius--sm 5 (rounded-r4), body--sm 12. */
export const SESSION_UNAVAILABLE_BUTTON_CLASS =
	"h-5 rounded-r4 px-1.5 text-[12px]/[17px] font-medium bg-fill-primary text-on-primary hover:bg-fill-primary-hover outline-none focus-visible:shadow-focus transition-shadow";

/**
 * Upstream's session-unavailable card: an empty 32px titlebar band over a centred `max-w-md` stack
 * holding the heading, its line and the actions.
 */
export function SessionUnavailable({
	heading,
	children,
	actions,
	alert = false,
}: Readonly<{heading: ReactNode; children: ReactNode; actions: ReactNode; alert?: boolean}>) {
	return (
		<div className="flex h-full flex-col">
			<div aria-hidden="true" className="h-8 shrink-0" />
			<div className="h-full flex flex-col items-center justify-center px-4">
				<div className="flex w-full max-w-md flex-col items-start gap-3 text-[13px]/[19px]">
					<h2 className="text-pretty text-[20px]/[25px] font-normal text-primary">{heading}</h2>
					<p role={alert ? "alert" : undefined} className="text-pretty text-secondary">
						{children}
					</p>
					<div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>
				</div>
			</div>
		</div>
	);
}

/** A session that doesn't exist: upstream's copy, with Start a new session doing what the sidebar New row does. */
export function SessionNotFound() {
	const navigate = useNavigate();
	return (
		<SessionUnavailable
			heading="This session couldn’t be found"
			actions={
				<button
					type="button"
					className={SESSION_UNAVAILABLE_BUTTON_CLASS}
					onClick={() => void navigate({to: "/"}).then(requestHomeComposerFocus)}
				>
					Start a new session
				</button>
			}
		>
			It may have been deleted, or you may not have access.
		</SessionUnavailable>
	);
}
