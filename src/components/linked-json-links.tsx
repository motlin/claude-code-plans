import {Bot, ExternalLink, FileText, Hash} from "lucide-react";
import type {ReactNode} from "react";
import {toMdSlug} from "../lib/md-slug";

export function resolveLink(value: string, key: string, ctx: LinkedJsonContext): ResolvedLink | null {
	if (key === "agentId" || key === "agent_id") {
		const agentSessionId = value.startsWith("agent-") ? value : `agent-${value}`;
		return {
			href: `/session/${agentSessionId}`,
			title: `Subagent session: ${agentSessionId}`,
			icon: <Bot className={ICON_SIZE} />,
		};
	}

	if (key === "sessionId" || key === "session_id") {
		if (UUID_RE.test(value)) {
			return {
				href: `/session/${value}`,
				title: `Session: ${value}`,
				icon: <Hash className={ICON_SIZE} />,
			};
		}
	}

	if (key === "tool_use_id" || key === "uuid" || key === "parentUuid" || key === "sourceUuid") {
		if (UUID_RE.test(value)) {
			const isKnown = ctx.knownUuids?.has(value) ?? true;
			if (isKnown) {
				return {
					href: `/session/${ctx.sessionId}/source/${value}`,
					title: `Source JSONL: ${value.slice(0, 8)}...`,
					icon: <FileText className={ICON_SIZE} />,
				};
			}
		}
	}

	if (key === "gitBranch" || key === "git_branch") {
		if (ctx.projectId) {
			return {
				href: `/project/${ctx.projectId}/sessions?branch=${encodeURIComponent(value)}`,
				title: `Branch: ${value}`,
				icon: <Hash className={ICON_SIZE} />,
			};
		}
	}

	if (URL_RE.test(value)) {
		return {
			href: value,
			title: value,
			icon: <ExternalLink className={ICON_SIZE} />,
			isExternal: true,
		};
	}

	const planMatch = PLAN_MD_RE.exec(value);
	if (planMatch?.[1]) {
		const filename = planMatch[1];
		return {
			href: `/plan/${encodeURIComponent(toMdSlug(filename))}`,
			title: `Plan: ${filename}`,
			icon: <FileText className={ICON_SIZE} />,
		};
	}

	const memoryMatch = MEMORY_MD_RE.exec(value);
	if (memoryMatch?.[1]) {
		const filename = memoryMatch[1];
		return {
			href: `/memory/${encodeURIComponent(filename)}`,
			title: `Memory: ${filename}`,
			icon: <FileText className={ICON_SIZE} />,
		};
	}

	if (AGENT_ID_RE.test(value) && (key === "id" || key === "parent_agent_id" || key === "parentAgentId")) {
		const agentSessionId = value.startsWith("agent-") ? value : `agent-${value}`;
		return {
			href: `/session/${agentSessionId}`,
			title: `Subagent session: ${agentSessionId}`,
			icon: <Bot className={ICON_SIZE} />,
		};
	}

	return null;
}

export interface LinkedJsonContext {
	sessionId: string;
	projectId?: string | undefined;
	knownUuids?: Set<string> | undefined;
}

interface ResolvedLink {
	href: string;
	title: string;
	icon: ReactNode;
	isExternal?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENT_ID_RE = /^(agent-|a[0-9a-f-]+)/i;

const URL_RE = /^https?:\/\/.+/;

const PLAN_MD_RE = /^plans\/(.+\.md)$/;

const MEMORY_MD_RE = /^memories\/(.+\.md)$/;

const ICON_SIZE = "h-3 w-3 inline-block ml-0.5 align-text-bottom";
