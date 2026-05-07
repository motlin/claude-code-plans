import {activeSessionsQueryOptions as apiActiveSessionsQueryOptions} from '../lib/api/sessions';

export const activeSessionsQueryOptions = (activeTimeoutMs?: number) => apiActiveSessionsQueryOptions(activeTimeoutMs);
