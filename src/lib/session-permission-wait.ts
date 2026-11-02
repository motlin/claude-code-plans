import {hasPermissionPromptForSession} from "./notifications-store";
import {getRegistrySessionState, type RegistrySessionState} from "./session-registry-store";

/** The registry's `waitingFor` while the CLI shows a tool permission prompt. */
const REGISTRY_PERMISSION_WAIT = "permission prompt";

/**
 * The session's CLI shows a tool permission prompt: a hook `permission_prompt`
 * notification still stands, or the live registry entry says it waits on one.
 * The registry also covers a prompt whose notification predates this server.
 * The session list and the permission endpoint both read this, so a card the
 * list draws is one the endpoint will answer.
 */
export function sessionAwaitingPermission(
	sessionId: string,
	registrySession: RegistrySessionState | null = getRegistrySessionState(sessionId),
): boolean
{
	return hasPermissionPromptForSession(sessionId) || registrySession?.waitingFor === REGISTRY_PERMISSION_WAIT;
}
