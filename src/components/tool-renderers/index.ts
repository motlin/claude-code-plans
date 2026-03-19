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
import {ExitPlanModeRenderer} from './exit-plan-mode-renderer';
import {SkillRenderer} from './skill-renderer';
import {McpRenderer} from './mcp-renderer';
import {WebFetchRenderer} from './webfetch-renderer';
import {FallbackRenderer} from './fallback-renderer';
import {ChromeDevtoolsRenderer} from './chrome-devtools-renderer';
import {GithubRenderer} from './github-renderer';
import {PlaywrightRenderer} from './playwright-renderer';

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
	ExitPlanMode: ExitPlanModeRenderer,
	Skill: SkillRenderer,
	WebFetch: WebFetchRenderer,
	__mcp__: McpRenderer,
	__fallback__: FallbackRenderer,
};

const mcpRegistry: Record<string, ComponentType<ToolRendererProps>> = {
	'chrome-devtools': ChromeDevtoolsRenderer,
	plugin_github_github: GithubRenderer,
	plugin_playwright_playwright: PlaywrightRenderer,
};

export function getToolRenderer(name: string): ComponentType<ToolRendererProps> {
	if (name.startsWith('mcp__')) {
		const server = name.slice(5).split('__')[0];
		if (server && mcpRegistry[server]) return mcpRegistry[server];
		return registry['__mcp__'] ?? registry['__fallback__']!;
	}
	return registry[name] ?? registry['__fallback__']!;
}

export type {ClientToolCall, ToolInput, ToolRendererProps} from './types';
