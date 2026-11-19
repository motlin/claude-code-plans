/**
 * Upstream `L1`'s first sentence (Tvqpf+) for the group "Archive all" confirm. Its working
 * and unloaded sentences are left out: a local archive never stops a session, and a
 * status group has no rows that haven't loaded.
 */
export function bulkArchiveDescription(count: number): string
{
	return `${count} session${count === 1 ? "" : "s"} will be archived.`;
}
