/** "claude-plugins-official" → "Claude Plugins Official". */
export function formatMarketplaceName(id: string): string {
	return id
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

export function isOfficialMarketplace(marketplaceId: string): boolean {
	return marketplaceId === "claude-plugins-official" || marketplaceId === "anthropic-agent-skills";
}
