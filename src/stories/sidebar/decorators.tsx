import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider} from '@tanstack/react-router';
import type {Decorator} from '@storybook/react-vite';

export function createStoryRouter(initialPath = '/') {
	const rootRoute = createRootRoute();
	const catchAllRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: '/$',
		component: () => null,
	});
	rootRoute.addChildren([catchAllRoute]);

	return createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: [initialPath]}),
	});
}

export function createStoryQueryClient(options?: {enabled: boolean}) {
	const queries: Record<string, unknown> = {retry: false, staleTime: Infinity};
	if (options) {
		queries['enabled'] = options.enabled;
	}
	return new QueryClient({defaultOptions: {queries}});
}

/**
 * Wraps a component with RouterProvider + QueryClientProvider.
 * Use directly when you need to pre-seed query data via render();
 * use withRouterAndQuery as a decorator for simpler cases.
 */
export function StoryWrapper({
	queryClient,
	initialPath = '/',
	children,
}: {
	queryClient?: QueryClient;
	initialPath?: string;
	children: React.ReactNode;
}) {
	const router = createStoryRouter(initialPath);
	const qc = queryClient ?? createStoryQueryClient();

	return (
		<QueryClientProvider client={qc}>
			<RouterProvider
				router={router}
				defaultComponent={() => <>{children}</>}
			/>
		</QueryClientProvider>
	);
}

/**
 * Decorator that provides TanStack Router + TanStack Query context.
 * Components using `Link`, `useNavigate`, `useMatches`, or `useQuery`
 * need this wrapper to render in Storybook.
 */
export const withRouterAndQuery: Decorator = (Story) => {
	const router = createStoryRouter();
	const queryClient = createStoryQueryClient();

	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider
				router={router}
				defaultComponent={() => <Story />}
			/>
		</QueryClientProvider>
	);
};
