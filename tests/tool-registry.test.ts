import {describe, expect, it} from 'vitest';
import {getToolRenderer} from '../src/components/tool-renderers/index';
import {BashRenderer} from '../src/components/tool-renderers/bash-renderer';
import {McpRenderer} from '../src/components/tool-renderers/mcp-renderer';
import {FallbackRenderer} from '../src/components/tool-renderers/fallback-renderer';
import {ChromeDevtoolsRenderer} from '../src/components/tool-renderers/chrome-devtools-renderer';

describe('getToolRenderer', () => {
	it('returns specific renderer for known tools', () => {
		expect(getToolRenderer('Bash')).toBe(BashRenderer);
	});

	it('returns fallback renderer for unknown tools', () => {
		expect(getToolRenderer('UnknownTool')).toBe(FallbackRenderer);
	});

	it('returns generic McpRenderer for unknown MCP servers', () => {
		expect(getToolRenderer('mcp__unknown_server__some_tool')).toBe(McpRenderer);
	});

	it('returns ChromeDevtoolsRenderer for chrome-devtools MCP tools', () => {
		expect(getToolRenderer('mcp__chrome-devtools__navigate_page')).toBe(ChromeDevtoolsRenderer);
	});

	it('returns ChromeDevtoolsRenderer for any chrome-devtools tool', () => {
		expect(getToolRenderer('mcp__chrome-devtools__take_screenshot')).toBe(ChromeDevtoolsRenderer);
	});

	it('extracts server name correctly from tool name with multiple underscores', () => {
		// mcp__<server>__<tool> — server is between first and second __
		expect(getToolRenderer('mcp__chrome-devtools__list_network_requests')).toBe(ChromeDevtoolsRenderer);
	});
});
