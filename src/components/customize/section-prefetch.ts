import type {QueryClient} from "@tanstack/react-query";
import {
	customizeClaudeAiConnectorsQueryOptions,
	customizeDiscoverQueryOptions,
	customizeMcpServersQueryOptions,
	customizeSkillsQueryOptions,
} from "../../lib/api/customize";
import {pluginsQueryOptions, userCommandsQueryOptions} from "../../lib/api/plugins";
import type {CustomizeSectionId} from "./sections";

// Route loaders stay in the client entry, so this lives apart from the section bodies it feeds.
/** Start fetching what a Customize section reads, for its route loader. */
export function prefetchCustomizeSection(queryClient: QueryClient, section: CustomizeSectionId): void {
	switch (section) {
		case "skills":
			void queryClient.prefetchQuery(customizeSkillsQueryOptions);
			void queryClient.prefetchQuery(userCommandsQueryOptions);
			void queryClient.prefetchQuery(customizeDiscoverQueryOptions);
			return;
		case "connectors":
			void queryClient.prefetchQuery(customizeMcpServersQueryOptions);
			void queryClient.prefetchQuery(customizeClaudeAiConnectorsQueryOptions);
			return;
		case "plugins":
			void queryClient.prefetchQuery(pluginsQueryOptions);
			void queryClient.prefetchQuery(customizeDiscoverQueryOptions);
			return;
	}
}
