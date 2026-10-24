import {useUnarchiveSession} from "../hooks/use-session-archive";
import {ApprovalActionButton} from "./approval-card";

/**
 * Upstream's archived-session stand-in: a neutral `role="note"` band that replaces the composer
 * with "This session is archived…" and an Unarchive button (busy while the request runs).
 */
export function ArchivedComposerNote({sessionId}: {sessionId: string}) {
	const {unarchive, pending} = useUnarchiveSession(sessionId);
	return (
		<div
			role="note"
			data-composer-stand-in=""
			className="flex gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 items-start py-[calc((40px-1lh)/2)] text-[13px]/[19px] band-enter"
		>
			<div className="flex min-w-0 flex-1 flex-wrap gap-2 items-start">
				<div className="min-w-0 flex-[1_1_32ch]">
					<span className="text-primary">
						This session is archived. Unarchive it to keep working in this session.
					</span>
				</div>
				<div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-start gap-2">
					<span className="flex h-[1lh] shrink-0 items-center">
						<ApprovalActionButton variant="secondary" busy={pending} disabled={pending} onClick={unarchive}>
							Unarchive
						</ApprovalActionButton>
					</span>
				</div>
			</div>
			{pending && (
				<span role="status" className="sr-only">
					Unarchiving…
				</span>
			)}
		</div>
	);
}
