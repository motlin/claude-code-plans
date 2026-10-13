import {type QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {RouterProvider} from "@tanstack/react-router";

import {ToastProvider} from "../../components/toast";
import {createStoryQueryClient, createStoryRouter} from "./router-and-query";

/**
 * Wraps a component with RouterProvider + QueryClientProvider.
 * Use directly when you need to pre-seed query data via render();
 * use withRouterAndQuery as a decorator for simpler cases.
 */
export function StoryWrapper({
	queryClient,
	initialPath = "/",
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
			<ToastProvider>
				<RouterProvider router={router} defaultComponent={() => <>{children}</>} />
			</ToastProvider>
		</QueryClientProvider>
	);
}
