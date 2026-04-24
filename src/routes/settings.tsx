import {createFileRoute, Link} from '@tanstack/react-router';
import {useState} from 'react';
import {Eye, Gauge, GitFork, Info, Palette, Sparkles, Webhook, Wrench, FileJson} from 'lucide-react';
import {useSettings, type Settings, type Verbosity} from '../components/settings-provider';
import {useTheme} from '../components/theme-provider';

export const Route = createFileRoute('/settings')({
	component: SettingsPage,
	head: () => ({
		meta: [{title: 'Settings'}],
	}),
});

type BooleanSettingKey = {[K in keyof Settings]: Settings[K] extends boolean ? K : never}[keyof Settings];
type NumberSettingKey = {[K in keyof Settings]: Settings[K] extends number ? K : never}[keyof Settings];

interface ToggleRowProps {
	label: string;
	description: string;
	settingKey: BooleanSettingKey;
}

function ToggleRow({label, description, settingKey}: ToggleRowProps) {
	const {settings, setSetting} = useSettings();
	const checked = settings[settingKey];

	return (
		<div className="flex items-center justify-between gap-4 py-2">
			<div>
				<div className="text-sm font-medium text-text-100">{label}</div>
				<div className="text-xs text-text-500">{description}</div>
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				onClick={() => setSetting(settingKey, !checked)}
				className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
					checked ? 'bg-accent-100' : 'bg-bg-300'
				}`}
			>
				<span
					className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
						checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
					}`}
				/>
			</button>
		</div>
	);
}

interface SelectRowProps<K extends keyof Settings> {
	label: string;
	description: string;
	settingKey: K;
	options: Array<{value: Settings[K]; label: string}>;
}

function SelectRow<K extends keyof Settings>({label, description, settingKey, options}: SelectRowProps<K>) {
	const {settings, setSetting} = useSettings();
	const current = settings[settingKey];

	return (
		<div className="flex items-center justify-between gap-4 py-2">
			<div>
				<div className="text-sm font-medium text-text-100">{label}</div>
				<div className="text-xs text-text-500">{description}</div>
			</div>
			<select
				value={String(current)}
				onChange={(e) => setSetting(settingKey, e.target.value as Settings[K])}
				className="rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
			>
				{options.map((option) => (
					<option
						key={String(option.value)}
						value={String(option.value)}
					>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

interface NumberRowProps {
	label: string;
	description: string;
	settingKey: NumberSettingKey;
	min?: number;
	max?: number;
}

function NumberRow({label, description, settingKey, min, max}: NumberRowProps) {
	const {settings, setSetting} = useSettings();
	const current = settings[settingKey];

	return (
		<div className="flex items-center justify-between gap-4 py-2">
			<div>
				<div className="text-sm font-medium text-text-100">{label}</div>
				<div className="text-xs text-text-500">{description}</div>
			</div>
			<input
				type="number"
				value={current}
				min={min}
				max={max}
				onChange={(e) => {
					const parsed = Number(e.target.value);
					if (Number.isFinite(parsed)) {
						setSetting(settingKey, parsed as Settings[NumberSettingKey]);
					}
				}}
				className="w-20 rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
			/>
		</div>
	);
}

function Section({icon: Icon, title, children}: {icon: React.ElementType; title: string; children: React.ReactNode}) {
	return (
		<section className="space-y-1">
			<div className="flex items-center gap-2 pb-1">
				<Icon className="h-4 w-4 text-text-500" />
				<h2 className="text-sm font-semibold text-text-100">{title}</h2>
			</div>
			<div className="divide-y divide-border-300/10">{children}</div>
		</section>
	);
}

function VerbositySection() {
	const {settings, setVerbosity} = useSettings();
	const verbosity = settings.verbosity;

	const presets: Array<{value: Verbosity; label: string; description: string}> = [
		{value: 'minimal', label: 'Minimal', description: 'Hide tools, thinking, hooks, and system content'},
		{value: 'normal', label: 'Normal', description: 'Show tools only (default)'},
		{
			value: 'verbose',
			label: 'Verbose',
			description: 'Show tools, thinking, hooks, system content, and timestamps',
		},
	];

	const isCustom = !presets.some((p) => p.value === verbosity);

	return (
		<Section
			icon={Gauge}
			title="Verbosity"
		>
			<div className="py-2">
				<div className="flex gap-2">
					{presets.map((preset) => (
						<button
							key={preset.value}
							type="button"
							onClick={() => setVerbosity(preset.value)}
							title={preset.description}
							className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
								verbosity === preset.value
									? 'bg-accent-100 text-white'
									: 'border border-border-300/15 text-text-300 hover:bg-bg-200'
							}`}
						>
							{preset.label}
						</button>
					))}
					{isCustom && (
						<span className="flex items-center rounded-md bg-bg-300/50 px-3 py-1.5 text-sm text-text-500">
							Custom
						</span>
					)}
				</div>
				<p className="mt-2 text-xs text-text-500">
					{isCustom
						? 'Individual toggles have been customized below.'
						: presets.find((p) => p.value === verbosity)?.description}
				</p>
			</div>
		</Section>
	);
}

function ThemeRow() {
	const {theme, setTheme} = useTheme();
	const options: Array<{value: typeof theme; label: string}> = [
		{value: 'light', label: 'Light'},
		{value: 'system', label: 'System'},
		{value: 'dark', label: 'Dark'},
	];

	return (
		<div className="flex items-center justify-between gap-4 py-2">
			<div>
				<div className="text-sm font-medium text-text-100">Theme</div>
				<div className="text-xs text-text-500">Color scheme for the interface</div>
			</div>
			<select
				value={theme}
				onChange={(e) => setTheme(e.target.value as typeof theme)}
				className="rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
			>
				{options.map((option) => (
					<option
						key={option.value}
						value={option.value}
					>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

function SettingsPage() {
	const {resetAll} = useSettings();
	const [confirmReset, setConfirmReset] = useState(false);

	return (
		<div className="max-w-3xl">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold">Settings</h1>
					<p className="mt-1 text-sm text-text-500">Configure display, appearance, and behavior.</p>
				</div>
				<Link
					to="/settings/edit"
					className="flex items-center gap-1.5 rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200"
				>
					<FileJson className="h-3.5 w-3.5" />
					Claude Config
				</Link>
			</div>

			<div className="mt-6 space-y-6">
				<VerbositySection />

				<Section
					icon={Eye}
					title="Session Display"
				>
					<ToggleRow
						label="Thinking"
						description="Show Claude's extended thinking blocks"
						settingKey="showThinking"
					/>
					<ToggleRow
						label="Tools"
						description="Show tool calls and results"
						settingKey="showTools"
					/>
					<ToggleRow
						label="Timestamps"
						description="Show timestamps on messages"
						settingKey="showTimestamps"
					/>
					<ToggleRow
						label="Tool duration"
						description="Show execution time for tool calls"
						settingKey="showToolDuration"
					/>
					<ToggleRow
						label="Debug"
						description="Show debug information and raw JSONL data"
						settingKey="showDebug"
					/>
				</Section>

				<Section
					icon={Webhook}
					title="Hooks"
				>
					<ToggleRow
						label="Passed hooks"
						description="Show hooks that passed without issues"
						settingKey="showPassedHooks"
					/>
					<ToggleRow
						label="Hook warnings"
						description="Show non-blocking hook warnings and additional context"
						settingKey="showHookWarnings"
					/>
					<ToggleRow
						label="Hook errors"
						description="Show blocking hook errors and cancellations"
						settingKey="showHookErrors"
					/>
				</Section>

				<Section
					icon={Info}
					title="System Content"
				>
					<ToggleRow
						label="System banners"
						description="Show system-level banner messages"
						settingKey="showSystemBanners"
					/>
				</Section>

				<Section
					icon={GitFork}
					title="Sub-agents"
				>
					<SelectRow
						label="Default view"
						description="Initial view mode for sub-agent visualizations"
						settingKey="defaultSubagentView"
						options={[
							{value: 'tree', label: 'Tree'},
							{value: 'gantt', label: 'Gantt'},
							{value: 'sequence', label: 'Sequence'},
						]}
					/>
				</Section>

				<Section
					icon={Palette}
					title="Appearance"
				>
					<ThemeRow />
					<ToggleRow
						label="Hide chrome"
						description="Hide the sidebar and header for a focused view"
						settingKey="chromeHidden"
					/>
					<ToggleRow
						label="Status footer"
						description="Show the status bar at the bottom of session views"
						settingKey="statusFooterVisible"
					/>
				</Section>

				<Section
					icon={Sparkles}
					title="AI Features"
				>
					<ToggleRow
						label="Auto-generate summaries"
						description="Automatically generate AI summaries for sessions"
						settingKey="autoGenerateSummaries"
					/>
				</Section>

				<Section
					icon={Wrench}
					title="Advanced"
				>
					<NumberRow
						label="Active timeout (seconds)"
						description="Seconds of inactivity before a session is considered idle"
						settingKey="activeTimeoutSec"
						min={10}
						max={600}
					/>
				</Section>
			</div>

			<div className="mt-8 border-t border-border-300/15 pt-6">
				{confirmReset ? (
					<div className="flex items-center gap-3">
						<span className="text-sm text-text-300">Reset all settings to defaults?</span>
						<button
							type="button"
							onClick={() => {
								resetAll();
								setConfirmReset(false);
							}}
							className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
						>
							Confirm
						</button>
						<button
							type="button"
							onClick={() => setConfirmReset(false)}
							className="rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200"
						>
							Cancel
						</button>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setConfirmReset(true)}
						className="rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200"
					>
						Reset all to defaults
					</button>
				)}
			</div>
		</div>
	);
}
