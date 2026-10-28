import {noop, type QueryClient} from "@tanstack/react-query";
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
			void queryClient.query(customizeSkillsQueryOptions).catch(noop);
			void queryClient.query(userCommandsQueryOptions).catch(noop);
			void queryClient.query(customizeDiscoverQueryOptions).catch(noop);
			return;
		case "connectors":
			void queryClient.query(customizeMcpServersQueryOptions).catch(noop);
			void queryClient.query(customizeClaudeAiConnectorsQueryOptions).catch(noop);
			return;
		case "plugins":
			void queryClient.query(pluginsQueryOptions).catch(noop);
			void queryClient.query(customizeDiscoverQueryOptions).catch(noop);
			return;
	}
}

/** Start fetching every source unified search reads, so a `?q=` deep link never counts a partial result set. */
export function prefetchUnifiedSearch(queryClient: QueryClient): void {
	void queryClient.query(customizeSkillsQueryOptions).catch(noop);
	void queryClient.query(userCommandsQueryOptions).catch(noop);
	void queryClient.query(customizeMcpServersQueryOptions).catch(noop);
	void queryClient.query(customizeClaudeAiConnectorsQueryOptions).catch(noop);
	void queryClient.query(pluginsQueryOptions).catch(noop);
	void queryClient.query(customizeDiscoverQueryOptions).catch(noop);
}
