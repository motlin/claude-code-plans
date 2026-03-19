import type {ToolRendererProps} from './types';
import {FallbackRenderer} from './fallback-renderer';

/**
 * Chrome DevTools MCP tool renderer.
 * Dispatches to sub-renderers based on the specific CDP tool name.
 * Full implementation in Phase 1.2.
 */
export function ChromeDevtoolsRenderer({toolCall}: ToolRendererProps) {
	// Stub: delegate to FallbackRenderer until Phase 1.2 adds sub-renderers
	return <FallbackRenderer toolCall={toolCall} />;
}
