import * as Sentry from '@sentry/react';
import {StartClient} from '@tanstack/react-start/client';
import {hydrateRoot} from 'react-dom/client';
import './router';

if (import.meta.env.DEV) {
	Sentry.init({
		dsn: 'https://spotlight@local/0',
		integrations: [
			Sentry.spotlightBrowserIntegration(),
			Sentry.captureConsoleIntegration({levels: ['log', 'info', 'warn', 'error', 'debug']}),
			Sentry.browserTracingIntegration(),
		],
		tracesSampleRate: 1.0,
	});
}

hydrateRoot(document, <StartClient />);
