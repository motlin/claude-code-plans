/**
 * Upstream's connector icon (`DY`) with no favicon source: the 16px transparent
 * tile (`gU` with its `!` overrides applied) around the letter tile (`DK`).
 */
export function ConnectorLetterTile({name}: {name: string})
{
	// Upstream reads `pr(name)?.connectorName ?? name`: a `plugin:<plugin>:<server>` key gives its server.
	const source = /^plugin:[^:]+:(.+)$/.exec(name)?.[1] ?? name;
	const letter = source.charAt(0).toUpperCase() || "?";
	return (
		<div
			className="shrink-0 flex items-center justify-center bg-transparent"
			style={
			{
				width: 16,
				height: 16,
				borderRadius: 4.32,
			}}
		>
			<div
				className="shrink-0 flex items-center justify-center overflow-clip bg-surface-3 text-secondary font-medium border border-border shadow-[0_0.8px_1.6px_0_color-mix(in_srgb,black_5%,transparent)]"
				style={
				{
					width: 16,
					height: 16,
					fontSize: 10.4,
					borderRadius: 4.8,
				}}
			>
				<p dir="auto" className="font-sans shrink-0 leading-tight">
					{letter}
				</p>
			</div>
		</div>
	);
}
