import {lazy, type ComponentType} from 'react';
import type {ToolRendererProps} from './types';

const ChromeDevtoolsRenderer = lazy(() =>
	import('./chrome-devtools-renderer').then((m) => ({default: m.ChromeDevtoolsRenderer})),
);
const GithubRenderer = lazy(() => import('./github-renderer').then((m) => ({default: m.GithubRenderer})));
const PlaywrightRenderer = lazy(() => import('./playwright-renderer').then((m) => ({default: m.PlaywrightRenderer})));
const ClaudeInChromeRenderer = lazy(() =>
	import('./claude-in-chrome-renderer').then((m) => ({default: m.ClaudeInChromeRenderer})),
);
const Context7Renderer = lazy(() => import('./context7-renderer').then((m) => ({default: m.Context7Renderer})));
const McpRenderer = lazy(() => import('./mcp-renderer').then((m) => ({default: m.McpRenderer})));
const FallbackRenderer = lazy(() => import('./fallback-renderer').then((m) => ({default: m.FallbackRenderer})));

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
