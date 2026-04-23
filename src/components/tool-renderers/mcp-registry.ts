import type {ComponentType} from 'react';
import type {ToolRendererProps} from './types';
import {ChromeDevtoolsRenderer} from './chrome-devtools-renderer';
import {GithubRenderer} from './github-renderer';
import {PlaywrightRenderer} from './playwright-renderer';
import {ClaudeInChromeRenderer} from './claude-in-chrome-renderer';
import {Context7Renderer} from './context7-renderer';
import {McpRenderer} from './mcp-renderer';
import {FallbackRenderer} from './fallback-renderer';

const mcpRegistry: Record<string, ComponentType<ToolRendererProps>> = {
	'chrome-devtools': ChromeDevtoolsRenderer,
	plugin_github_github: GithubRenderer,
	plugin_playwright_playwright: PlaywrightRenderer,
	'claude-in-chrome': ClaudeInChromeRenderer,
	plugin_context7_context7: Context7Renderer,
};

export function getMcpRenderer(serverName: string): ComponentType<ToolRendererProps> {
	return mcpRegistry[serverName] ?? McpRenderer ?? FallbackRenderer;
}
