/**
 * Upstream `Q$`'s ack test for a failed row: the failure stands, read or not, until Mark as completed acks the row
 * at or after its mtime (`ack >= updated_at`) or its failure (`ack >= errorAt`, which survives a later mtime bump).
 */
export function isFailedUnacked(
	session:
	{
		failedAt?: string | undefined;
		mtime: string;
		archived: boolean;
	},
	ackedAtMs: number | undefined,
): boolean
{
	if (session.failedAt === undefined || session.archived) return false;
	if (ackedAtMs === undefined) return true;
	return ackedAtMs < Date.parse(session.mtime) && ackedAtMs < Date.parse(session.failedAt);
}
