import {createRouter} from "@tanstack/react-router";
import {QueryClient} from "@tanstack/react-query";
import {setupRouterSsrQueryIntegration} from "@tanstack/react-router-ssr-query";
import {routeTree} from "./routeTree.gen";
import {shouldRetryQuery} from "./lib/query-retry";
import {DefaultErrorComponent} from "./routes/__root";

export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				refetchOnWindowFocus: false,
				retry: shouldRetryQuery,
			},
		},
	});

	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultErrorComponent: DefaultErrorComponent,
		// Query manages data freshness; always run loaders so their static-staleTime query() calls can serve from cache.
		defaultPreloadStaleTime: 0,
		context: {queryClient},
	});

	setupRouterSsrQueryIntegration({router, queryClient});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
	interface StaticDataRouteOption {
		/** Render the route edge to edge, without the root layout's horizontal padding. */
		fullBleed?: boolean;
		/** Home/chat have bounded tiles with their own scrollports. */
		tileShell?: "home" | "session";
		/**
		 * "tight": Customize's upstream 8px page gutter, inside which its own column adds 32px.
		 * "none": no root gutter; the page pads its own max-width box (Artifacts' upstream
		 * `mx-auto w-full px-md md:px-8 max-w-5xl`).
		 */
		pageGutter?: "tight" | "none";
	}
}
