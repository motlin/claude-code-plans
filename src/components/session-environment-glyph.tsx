import {useQuery} from "@tanstack/react-query";
import {Laptop} from "lucide-react";

import {sessionOpenInQueryOptions} from "../lib/api/sessions";
import {Menu, MenuContent, MenuTrigger} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";

const REMOTE_CONTROL_DOCS_URL = "https://code.claude.com/docs/en/remote-control";

const GLYPH_CLASS =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 data-[popup-open]:bg-fill-ghost-hover [&_svg]:size-[18px]";

/** Mounted only while the popover is open, so a closed glyph never queries. */
function EnvironmentStatus({sessionId}: {sessionId: string}) {
	const {data: openIn} = useQuery(sessionOpenInQueryOptions(sessionId));
	const connected = (openIn?.bridgeSessionId ?? null) !== null;
	return (
		<p
			data-environment-status={connected ? "connected" : "disconnected"}
			className="flex w-[232px] items-start gap-2 px-2 py-1 text-[13px]/[19px] text-primary"
		>
			<span
				aria-hidden
				className={`mt-[6.5px] size-1.5 shrink-0 rounded-full ${
					connected ? "bg-accent-100" : "shadow-[inset_0_0_0_1px_var(--color-accent-100)]"
				}`}
			/>
			<span>
				{connected ? "Connected via Remote Control. " : "Not connected via Remote Control. "}
				<a
					href={REMOTE_CONTROL_DOCS_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="text-accent-000 underline decoration-current/40"
				>
					Learn more
				</a>
			</span>
		</p>
	);
}

/**
 * Upstream's environment glyph before the session title: a laptop for a local
 * session, opening its Remote Control status.
 */
export function SessionEnvironmentGlyph({sessionId}: {sessionId: string}) {
	return (
		<Menu>
			<Tooltip content="Local session" side="bottom">
				<MenuTrigger aria-label="Environment" className={GLYPH_CLASS}>
					<Laptop aria-hidden />
				</MenuTrigger>
			</Tooltip>
			<MenuContent>
				<EnvironmentStatus sessionId={sessionId} />
			</MenuContent>
		</Menu>
	);
}
