import type {Meta, StoryObj} from '@storybook/react-vite';
import {AttachmentBanner} from '../../components/attachment-banner';

const meta = {
	title: 'Session Detail/AttachmentBanner',
	component: AttachmentBanner,
} satisfies Meta<typeof AttachmentBanner>;
export default meta;

type Story = StoryObj<typeof meta>;

export const HookSuccess: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'hook_success',
			hookName: 'pre-commit-lint',
			hookEvent: 'PreToolUse',
			durationMs: 234,
		}),
	},
};

export const HookNonBlockingError: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'hook_non_blocking_error',
			hookName: 'eslint-check',
			hookEvent: 'PostToolUse',
			stderr: 'Warning: 3 lint issues found',
			exitCode: 1,
		}),
	},
};

export const HookCancelled: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'hook_cancelled',
			hookName: 'format-check',
			hookEvent: 'PreToolUse',
		}),
	},
};

export const HookAdditionalContext: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'hook_additional_context',
			hookName: 'code-review',
			hookEvent: 'PostToolUse',
			content: 'Additional review notes from the hook',
		}),
	},
};

export const FileAttachment: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'file',
			filename: 'src/lib/sessions.ts',
			displayPath: 'src/lib/sessions.ts',
		}),
	},
};

export const DirectoryAttachment: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'directory',
			path: '/Users/craig/projects/claude-code-plans/src',
			displayPath: 'src/',
		}),
	},
};

export const CompactFileReference: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'compact_file_reference',
			filename: 'package.json',
			displayPath: 'package.json',
		}),
	},
};

export const EditedTextFile: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'edited_text_file',
			filename: 'src/components/session-chat.tsx',
		}),
	},
};

export const SelectedLinesInIde: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'selected_lines_in_ide',
			ideName: 'VS Code',
			filename: 'src/lib/schemas.ts',
			displayPath: 'src/lib/schemas.ts',
			lineStart: 100,
			lineEnd: 150,
		}),
	},
};

export const OpenedFileInIde: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'opened_file_in_ide',
			filename: 'tsconfig.json',
		}),
	},
};

export const DateChange: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'date_change',
			newDate: '2026-04-21',
		}),
	},
};

export const CommandPermissions: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'command_permissions',
			model: 'claude-opus-4-6',
			allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
		}),
	},
};

export const CompanionIntro: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'companion_intro',
			name: 'Whiskers',
			species: 'cat',
		}),
	},
};

export const UltrathinkEffort: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'ultrathink_effort',
			level: 'high',
		}),
	},
};

export const PlanMode: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'plan_mode',
			planFilePath: '/Users/craig/.claude/plans/2026-04-21-my-plan.md',
			planExists: true,
		}),
	},
};

export const PlanModeExit: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'plan_mode_exit',
			planFilePath: '/Users/craig/.claude/plans/2026-04-21-my-plan.md',
		}),
	},
};

export const DeferredToolsDelta: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'deferred_tools_delta',
			addedNames: ['WebFetch', 'WebSearch', 'SendMessage'],
			removedNames: ['ToolSearch'],
		}),
	},
};

export const McpInstructionsDelta: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'mcp_instructions_delta',
			addedNames: ['context7', 'github'],
		}),
	},
};

export const SkillListing: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'skill_listing',
			skillCount: 42,
			isInitial: true,
		}),
	},
};

export const InvokedSkills: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'invoked_skills',
			skills: ['code-quality', 'git-workflow', 'precommit'],
		}),
	},
};

export const TaskReminder: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'task_reminder',
			itemCount: 5,
		}),
	},
};

export const TodoReminder: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'todo_reminder',
			itemCount: 3,
		}),
	},
};

export const QueuedCommand: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'queued_command',
			prompt: 'Fix the failing test in src/lib/sessions.test.ts',
			commandMode: 'normal',
		}),
	},
};

export const Diagnostics: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'diagnostics',
			isNew: true,
			files: [{path: 'src/lib/schemas.ts', issues: 3}],
		}),
	},
};

export const AutoMode: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'auto_mode',
			reminderType: 'initial',
		}),
	},
};

export const MaxTurnsReached: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'max_turns_reached',
			maxTurns: 50,
			turnCount: 50,
		}),
	},
};

export const PlanModeReentry: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'plan_mode_reentry',
			planFilePath: '/Users/craig/.claude/plans/2026-04-21-my-plan.md',
			planExists: true,
		}),
	},
};

export const PlanFileReference: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'plan_file_reference',
			planFilePath: '/Users/craig/.claude/plans/2026-04-21-my-plan.md',
		}),
	},
};

export const NestedMemory: Story = {
	args: {
		attachmentJson: JSON.stringify({
			type: 'nested_memory',
			path: '/Users/craig/projects/claude-code-plans/CLAUDE.md',
			displayPath: 'CLAUDE.md',
		}),
	},
};
