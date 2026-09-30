import {Link} from "@tanstack/react-router";
import {MessagesSquare} from "lucide-react";

/**
 * `/herdr/terminal/$sessionId` and `/session/$id` are two views of the same
 * Claude session under two different param names; this link crosses from the
 * terminal back to the transcript.
 */
export function SessionTranscriptLink({sessionId}: {sessionId: string}) {
	const label = `Open session transcript for ${sessionId}`;
	return (
		<Link
			to="/session/$id"
			params={{id: sessionId}}
			className="ml-auto flex size-8 items-center justify-center rounded-md text-t6 transition-colors hover:bg-surface-0/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
			aria-label={label}
			title={label}
		>
			<MessagesSquare aria-hidden="true" className="h-4 w-4" />
		</Link>
	);
}
