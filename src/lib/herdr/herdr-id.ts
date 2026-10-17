/**
 * Pane, tab and workspace ids are only unique within one herdr server, so ids
 * from a named session (`herdr --session later`) carry that session after an
 * `@` (`wM:p1@later`). Default-server ids stay bare. Terminal ids are random
 * and globally unique, so they are never qualified. Client-safe: no Node imports.
 */
const SEPARATOR = "@";

/** `session` is null for the default server. */
export function qualifyHerdrId(id: string, session: string | null): string {
	return session === null ? id : `${id}${SEPARATOR}${session}`;
}

export function splitHerdrId(qualifiedId: string): {id: string; session: string | null} {
	const index = qualifiedId.indexOf(SEPARATOR);
	if (index === -1) return {id: qualifiedId, session: null};
	return {id: qualifiedId.slice(0, index), session: qualifiedId.slice(index + 1)};
}
