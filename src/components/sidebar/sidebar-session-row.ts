import type {SessionListItem} from "../../lib/api/sessions";
import type {SessionGroupRow} from "../../lib/session-groups";

export interface SidebarSessionRow extends SessionGroupRow {
	id: string;
	session: SessionListItem;
}

export function toGroupRow(session: SessionListItem): SidebarSessionRow {
	return {
		session,
		id: session.id,
		sessionId: session.id,
		title: session.title,
		bucket: session.bucket,
		project: session.projectName,
		archived: session.archived,
		createdAt: Date.parse(session.created),
		lastActivityAt: Date.parse(session.mtime),
		forkedFromSessionId: session.forkedFromSessionId,
		live: session.state !== "ended",
	};
}
