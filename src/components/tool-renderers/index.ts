import type {ComponentType} from 'react';
import type {ToolRendererProps} from './types';
import {EditRenderer} from './edit-renderer';
import {BashRenderer} from './bash-renderer';
import {ReadRenderer} from './read-renderer';
import {WriteRenderer} from './write-renderer';
import {GlobRenderer} from './glob-renderer';
import {GrepRenderer} from './grep-renderer';
import {AskUserQuestionRenderer} from './ask-user-question-renderer';
import {AgentRenderer} from './agent-renderer';
import {TaskCreateRenderer} from './task-create-renderer';
import {TaskUpdateRenderer} from './task-update-renderer';
import {TaskGetRenderer} from './task-get-renderer';
import {TaskListRenderer} from './task-list-renderer';
import {ExitPlanModeRenderer} from './exit-plan-mode-renderer';
import {EnterPlanModeRenderer} from './enter-plan-mode-renderer';
import {TodoWriteRenderer} from './todo-write-renderer';
import {WebSearchRenderer} from './web-search-renderer';
import {SendMessageRenderer} from './send-message-renderer';
import {TaskStopRenderer} from './task-stop-renderer';
import {CronCreateRenderer} from './cron-create-renderer';
import {SkillRenderer} from './skill-renderer';
import {WebFetchRenderer} from './webfetch-renderer';
import {FallbackRenderer} from './fallback-renderer';
import {getMcpRenderer} from './mcp-registry';

const registry: Record<string, ComponentType<ToolRendererProps>> = {
	Edit: EditRenderer,
	MultiEdit: EditRenderer,
	Bash: BashRenderer,
	Read: ReadRenderer,
	Write: WriteRenderer,
	Glob: GlobRenderer,
	Grep: GrepRenderer,
	AskUserQuestion: AskUserQuestionRenderer,
	Agent: AgentRenderer,
	TaskCreate: TaskCreateRenderer,
	TaskUpdate: TaskUpdateRenderer,
	TaskGet: TaskGetRenderer,
	TaskList: TaskListRenderer,
	ExitPlanMode: ExitPlanModeRenderer,
	EnterPlanMode: EnterPlanModeRenderer,
	TodoWrite: TodoWriteRenderer,
	WebSearch: WebSearchRenderer,
	SendMessage: SendMessageRenderer,
	TaskStop: TaskStopRenderer,
	CronCreate: CronCreateRenderer,
	Skill: SkillRenderer,
	WebFetch: WebFetchRenderer,
	__fallback__: FallbackRenderer,
};

export function getToolRenderer(name: string): ComponentType<ToolRendererProps> {
	if (name.startsWith('mcp__')) {
		const server = name.slice(5).split('__')[0];
		if (server) return getMcpRenderer(server);
		return registry['__fallback__']!;
	}
	return registry[name] ?? registry['__fallback__']!;
}

export type {ClientToolCall, SerializedToolResultMap} from './types';
