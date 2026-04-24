import React, {useMemo} from 'react';
import {AttachmentPayloadSchema, type AttachmentPayload} from '../lib/schemas';

/**
 * Renders a JSONL attachment record as a compact informational banner.
 * Each attachment sub-type gets a contextual icon and label.
 * Accepts JSON-serialized attachment to avoid TanStack serialization issues.
 */
export function AttachmentBanner({attachmentJson}: {attachmentJson: string}) {
	const attachment = useMemo<AttachmentPayload | null>(() => {
		const parsed = AttachmentPayloadSchema.safeParse(JSON.parse(attachmentJson));
		return parsed.success ? parsed.data : null;
	}, [attachmentJson]);

	if (!attachment) return null;

	return <AttachmentContent attachment={attachment} />;
}

function AttachmentContent({attachment}: {attachment: AttachmentPayload}) {
	switch (attachment.type) {
		// -- Hook results --
		case 'hook_success':
			return (
				<Banner
					icon="✅"
					label={`Hook passed: ${attachment.hookName}`}
				>
					{attachment.durationMs !== undefined && (
						<span className="text-text-600">{attachment.durationMs}ms</span>
					)}
				</Banner>
			);
		case 'hook_non_blocking_error':
			return (
				<Banner
					icon="⚠️"
					label={`Hook error (non-blocking): ${attachment.hookName}`}
				>
					{attachment.stderr && <Pre>{attachment.stderr}</Pre>}
				</Banner>
			);
		case 'hook_cancelled':
			return (
				<Banner
					icon="🚫"
					label={`Hook cancelled: ${attachment.hookName}`}
				/>
			);
		case 'hook_additional_context':
			return (
				<Banner
					icon="📎"
					label={`Hook context: ${attachment.hookName}`}
				>
					{typeof attachment.content === 'string' && attachment.content.length > 0 && (
						<Pre>{attachment.content}</Pre>
					)}
				</Banner>
			);
		case 'hook_blocking_error':
			return (
				<Banner
					icon="🛑"
					label={`Hook blocked: ${attachment.hookName}`}
				/>
			);

		// -- File context --
		case 'file':
			return (
				<Banner
					icon="📄"
					label={attachment.displayPath ?? attachment.filename}
				/>
			);
		case 'directory':
			return (
				<Banner
					icon="📁"
					label={attachment.displayPath ?? attachment.path ?? 'directory'}
				/>
			);
		case 'compact_file_reference':
			return (
				<Banner
					icon="📄"
					label={attachment.displayPath ?? attachment.filename ?? 'file reference'}
				/>
			);
		case 'edited_text_file':
			return (
				<Banner
					icon="✏️"
					label={`Edited: ${attachment.filename}`}
				/>
			);
		case 'selected_lines_in_ide': {
			const filePart = attachment.displayPath ?? attachment.filename ?? 'file';
			const linePart =
				attachment.lineStart !== undefined
					? `:${attachment.lineStart}${attachment.lineEnd !== undefined ? `-${attachment.lineEnd}` : ''}`
					: '';
			return (
				<Banner
					icon="🔍"
					label={`Selected in ${attachment.ideName ?? 'IDE'}: ${filePart}${linePart}`}
				/>
			);
		}
		case 'opened_file_in_ide':
			return (
				<Banner
					icon="📂"
					label={`Opened in IDE: ${attachment.filename ?? 'file'}`}
				/>
			);

		// -- System info --
		case 'date_change':
			return (
				<Banner
					icon="📅"
					label={attachment.newDate}
				/>
			);
		case 'command_permissions':
			return (
				<Banner
					icon="🔑"
					label={`Permissions${attachment.model ? ` (${attachment.model})` : ''}`}
				>
					{attachment.allowedTools && attachment.allowedTools.length > 0 && (
						<span className="text-text-600">{attachment.allowedTools.length} tools allowed</span>
					)}
				</Banner>
			);
		case 'companion_intro':
			return (
				<Banner
					icon="🐾"
					label={[attachment.name, attachment.species].filter(Boolean).join(' the ') || 'Companion'}
				/>
			);
		case 'ultrathink_effort':
			return (
				<Banner
					icon="🧠"
					label={`Thinking effort: ${attachment.level ?? 'unknown'}`}
				/>
			);

		// -- Plan/mode transitions --
		case 'plan_mode':
			return (
				<Banner
					icon="📋"
					label="Plan mode"
				>
					{attachment.planFilePath && (
						<span
							className="font-mono text-text-600 truncate max-w-xs"
							title={attachment.planFilePath}
						>
							{attachment.planFilePath.split('/').pop()}
						</span>
					)}
				</Banner>
			);
		case 'plan_mode_exit':
			return (
				<Banner
					icon="📋"
					label="Exited plan mode"
				/>
			);

		// -- Tool/MCP ecosystem --
		case 'deferred_tools_delta': {
			const parts: string[] = [];
			if (attachment.addedNames?.length) parts.push(`+${attachment.addedNames.length} tools`);
			if (attachment.removedNames?.length) parts.push(`-${attachment.removedNames.length} tools`);
			return (
				<Banner
					icon="🔧"
					label={`Deferred tools: ${parts.join(', ') || 'updated'}`}
				/>
			);
		}
		case 'mcp_instructions_delta': {
			const parts: string[] = [];
			if (attachment.addedNames?.length) parts.push(`+${attachment.addedNames.length}`);
			if (attachment.removedNames?.length) parts.push(`-${attachment.removedNames.length}`);
			return (
				<Banner
					icon="🔌"
					label={`MCP instructions: ${parts.join(', ') || 'updated'}`}
				/>
			);
		}
		case 'skill_listing':
			return (
				<Banner
					icon="⚡"
					label={`Skills${attachment.skillCount !== undefined ? ` (${attachment.skillCount})` : ''}${attachment.isInitial ? ' — initial' : ''}`}
				/>
			);
		case 'invoked_skills':
			return (
				<Banner
					icon="⚡"
					label={`Invoked ${attachment.skills?.length ?? 0} skill${(attachment.skills?.length ?? 0) === 1 ? '' : 's'}`}
				/>
			);

		// -- Reminders --
		case 'task_reminder':
		case 'todo_reminder': {
			const kind = attachment.type === 'task_reminder' ? 'Task' : 'Todo';
			return (
				<Banner
					icon="📌"
					label={`${kind} reminder${attachment.itemCount !== undefined ? ` (${attachment.itemCount} items)` : ''}`}
				/>
			);
		}

		// -- Commands --
		case 'queued_command':
			return (
				<Banner
					icon="⏳"
					label="Queued command"
				>
					{typeof attachment.prompt === 'string' && attachment.prompt.length > 0 && (
						<span
							className="text-text-600 truncate max-w-sm"
							title={attachment.prompt}
						>
							{attachment.prompt.length > 80 ? `${attachment.prompt.slice(0, 80)}...` : attachment.prompt}
						</span>
					)}
				</Banner>
			);

		// -- Diagnostics --
		case 'diagnostics':
			return (
				<Banner
					icon="🔬"
					label={`Diagnostics${attachment.isNew ? ' (new)' : ''}`}
				>
					{attachment.files && attachment.files.length > 0 && (
						<span className="text-text-600">
							{attachment.files.length} file{attachment.files.length === 1 ? '' : 's'}
						</span>
					)}
				</Banner>
			);
		default:
			throw new Error(`Unhandled attachment type: ${(attachment as {type: string}).type}`);
	}
}

export function Banner({icon, label, children}: {icon: string; label?: string; children?: React.ReactNode}) {
	return (
		<div className="flex flex-wrap items-center gap-2 py-1.5 px-3 text-xs text-text-500 bg-bg-100 rounded-md border border-border-300/10">
			<span>{icon}</span>
			{label && <span>{label}</span>}
			{children}
		</div>
	);
}

function Pre({children}: {children: React.ReactNode}) {
	return (
		<pre className="w-full mt-1 text-[10px] leading-tight text-text-600 bg-bg-200 rounded px-2 py-1 whitespace-pre-wrap break-all">
			{children}
		</pre>
	);
}
