import {Outlet, createRootRoute, HeadContent, Scripts, useRouter} from '@tanstack/react-router';
import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {ThemeProvider} from '../components/theme-provider';
import {ModeToggle} from '../components/mode-toggle';
import {Sidebar} from '../components/sidebar';
import appCss from '../styles/globals.css?url';

export const Route = createRootRoute({
	head: () => ({
		meta: [{charSet: 'utf-8'}, {name: 'viewport', content: 'width=device-width, initial-scale=1'}],
		links: [
			{rel: 'stylesheet', href: appCss},
			{
				rel: 'icon',
				type: 'image/svg+xml',
				href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23C87B3A'/%3E%3Cpath d='M16 5L17.5 13.5L26 16L17.5 18.5L16 27L14.5 18.5L6 16L14.5 13.5Z' fill='white' opacity='0.95'/%3E%3C/svg%3E",
			},
			{rel: 'preconnect', href: 'https://fonts.googleapis.com'},
			{rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous'},
			{
				rel: 'stylesheet',
				href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=JetBrains+Mono:wght@400;600&display=swap',
			},
		],
	}),
	component: RootComponent,
	notFoundComponent: NotFound,
});

function RootComponent() {
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);

	return (
		<RootDocument>
			<ThemeProvider>
				<div className="flex h-screen">
					<Sidebar
						collapsed={sidebarCollapsed}
						onToggle={() => setSidebarCollapsed((c) => !c)}
						refreshKey={refreshKey}
					/>
					<main className="flex-1 overflow-y-auto bg-bg-000">
						<div className="flex items-center justify-end p-3">
							<ModeToggle />
						</div>
						<div className="px-4 pb-8 sm:px-8">
							<Outlet />
						</div>
					</main>
				</div>
				<SseListener onContentUpdated={useCallback(() => setRefreshKey((k) => k + 1), [])} />
			</ThemeProvider>
		</RootDocument>
	);
}

function SseListener({onContentUpdated}: {onContentUpdated: () => void}) {
	const router = useRouter();

	useEffect(() => {
		const es = new EventSource('/api/events');
		es.addEventListener('content-updated', () => {
			router.invalidate();
			onContentUpdated();
		});
		return () => es.close();
	}, [router, onContentUpdated]);

	return null;
}

function NotFound() {
	return (
		<div className="p-8">
			<h1 className="text-lg font-semibold">404 &mdash; Not Found</h1>
			<p className="mt-2 text-text-500">The requested page was not found.</p>
		</div>
	);
}

function RootDocument({children}: Readonly<{children: ReactNode}>) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
		>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
