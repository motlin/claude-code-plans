// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useEffect, useRef, useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {HOME_RECENT_LIMIT, useHomeLaunchFolder, useHomeWorktree} from "../src/components/home/launch-folder";
import {HomeLaunchFolderProvider} from "../src/components/home/launch-folder-provider";
import {ProjectPicker} from "../src/components/home/project-picker";
import {WorktreeToggleChip} from "../src/components/home/worktree-toggle-chip";
import {HomeStartCard, StartCard} from "../src/components/home/start-card";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {onHomeComposerFocusRequest, requestHomeLaunchFolder} from "../src/lib/home-composer-focus";
import {HOME_WORKTREE_STORAGE_KEY} from "../src/lib/home-worktree-pref";
import {selectNextSteps, type NextStepCandidate} from "../src/lib/home-next-steps";
import type {StartProject} from "../src/lib/palette-start-session";
import {installLocalStorage} from "./fake-storage";

const PROJECTS: StartProject[] = [1, 2, 3, 4, 5].map((n) => ({
	id: `-users-dev-p${n}`,
	name: `p${n}`,
	projectPath: `/Users/dev/projects/p${n}`,
}));

/** Stands in for the docked composer: focuses its textarea on a home-composer focus request. */
function FakeComposer() {
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => onHomeComposerFocusRequest(() => ref.current?.focus()), []);
	return <textarea ref={ref} aria-label="Prompt" />;
}

function rows() {
	const list = screen.getByRole("list", {name: "Recent folders"});
	return within(list)
		.getAllByRole("listitem")
		.map((item) => ({
			text: item.textContent,
			current: item.getAttribute("aria-current"),
			title: item.querySelector("[title]")?.getAttribute("title") ?? null,
			button: item.querySelector("button")?.textContent ?? null,
			check: item.querySelector("[data-start-card-check]") !== null,
		}));
}

afterEach(() => {
	cleanup();
});

describe("StartCard", () => {
	it("shows the top two folders plus a selected 5th in the 3rd seat, checked and static", () => {
		render(<StartCard projects={PROJECTS} selected={PROJECTS[4]} onSelect={() => {}} />);

		expect(rows()).toStrictEqual([
			{text: "p1", current: null, title: null, button: "p1", check: false},
			{text: "p2", current: null, title: null, button: "p2", check: false},
			{text: "p5~/projects/p5", current: "true", title: null, button: null, check: true},
			{
				text: "Choose environment",
				current: null,
				title: null,
				button: "Choose environment",
				check: false,
			},
		]);
	});

	it("keeps the top three when the selection is among them", () => {
		render(<StartCard projects={PROJECTS} selected={PROJECTS[1]} onSelect={() => {}} />);

		expect(rows().map(({text, current}) => ({text, current}))).toStrictEqual([
			{text: "p1", current: null},
			{text: "p2~/projects/p2", current: "true"},
			{text: "p3", current: null},
			{text: "Choose environment", current: null},
		]);
	});

	it("puts the current row's shortened cwd in an sr-only span before the Check, like upstream's r5", () => {
		const {container} = render(<StartCard projects={PROJECTS} selected={PROJECTS[4]} onSelect={() => {}} />);
		const current = container.querySelector("li[aria-current] [data-start-card-check]")?.parentElement;

		expect(
			[...(current?.children ?? [])].map((child) => ({
				tag: child.tagName,
				className: child.getAttribute("class"),
				text: child.textContent,
			})),
		).toStrictEqual([
			{tag: "svg", className: "lucide lucide-folder size-4 shrink-0 text-secondary-control", text: ""},
			{tag: "SPAN", className: "min-w-0 flex-1 truncate text-start text-secondary-control", text: "p5"},
			{tag: "SPAN", className: "sr-only", text: "~/projects/p5"},
			{tag: "svg", className: "lucide lucide-check size-4 shrink-0 text-primary", text: ""},
		]);
	});

	it("inks a non-current row, its Folder icon and title, and the Choose environment title with upstream's control ink", () => {
		render(<StartCard projects={PROJECTS} selected={PROJECTS[4]} onSelect={() => {}} />);
		const row = screen.getByRole("button", {name: "p1"});
		const choose = screen.getByRole("button", {name: "Choose environment"});

		expect({
			row: row.className.split(" ").filter((token) => token.startsWith("text-secondary")),
			children: [...row.children].map((child) => child.getAttribute("class")),
			chooseTitle: choose.querySelector("span > span")?.className,
		}).toStrictEqual({
			row: ["text-secondary-control"],
			children: [
				"lucide lucide-folder size-4 shrink-0 text-secondary-control",
				"min-w-0 flex-1 truncate text-start text-secondary-control",
			],
			chooseTitle: "min-w-0 max-w-full truncate text-secondary-control",
		});
	});

	it("peeks Clawd over the env card as the start card's first child, marking the env card for placement", () => {
		const {container} = render(<StartCard projects={PROJECTS} selected={PROJECTS[0]} onSelect={() => {}} />);
		const card = container.querySelector("[data-start-card]");
		const clawd = card?.firstElementChild;
		const mascot = clawd?.querySelector<HTMLButtonElement>("[data-clawd-mascot]");
		if (!mascot) throw new Error("Expected the Clawd mascot in the start card");
		const before = {
			children: [...(card?.children ?? [])].map((child) => child.getAttribute("data-testid") ?? child.tagName),
			wrapper: {className: clawd?.getAttribute("class"), zIndex: (clawd as HTMLElement).style.zIndex},
			envMarked: screen.getByRole("list", {name: "Recent folders"}).hasAttribute("data-start-card-environments"),
			ariaHidden: mascot.getAttribute("aria-hidden"),
			tabIndex: mascot.getAttribute("tabindex"),
			viewBox: mascot.querySelector("svg")?.getAttribute("viewBox"),
			art: {
				width: mascot.querySelector("svg")?.getAttribute("width"),
				height: mascot.querySelector("svg")?.getAttribute("height"),
				className: mascot.querySelector("svg")?.getAttribute("class"),
			},
			box: mascot.className,
			hopping: mascot.hasAttribute("data-hopping"),
		};
		fireEvent.click(mascot);
		const afterClick = mascot.hasAttribute("data-hopping");
		// jsdom has no AnimationEvent, so React listens for the prefixed name instead of `animationend`.
		fireEvent(mascot, new Event("webkitAnimationEnd", {bubbles: true}));

		expect({...before, afterClick, afterEnd: mascot.hasAttribute("data-hopping")}).toStrictEqual({
			children: ["start-card-clawd", "start-card-environments"],
			wrapper: {className: "pointer-events-none relative h-0 -mb-3 w-80 max-w-full shrink-0", zIndex: "2"},
			envMarked: true,
			ariaHidden: "true",
			tabIndex: "-1",
			viewBox: "0 0 2750 1850",
			art: {width: "49", height: "33", className: "absolute top-[34px] left-[22px]"},
			box: "clawd-mascot pointer-events-none absolute right-[-13px] bottom-[calc(var(--cds-ring-outer,0px)-144px/11)] h-[80px] w-[80px] -scale-x-100 cursor-default border-0 bg-transparent p-0 outline-none [&_path]:pointer-events-auto",
			hopping: false,
			afterClick: true,
			afterEnd: false,
		});
	});

	it("leads Next steps with Clawd when there is no env card", () => {
		const {container} = render(
			<StartCard
				projects={[]}
				selected={undefined}
				onSelect={() => {}}
				nextSteps={{
					rows: selectNextSteps({
						candidates: [
							{
								id: "waiting-session",
								subject: "s1",
								stamp: 100,
								title: "Task 1",
								detail: "Asked a question",
							},
						],
						dismissed: {},
					}),
					onOpen: () => {},
					onDismiss: () => {},
				}}
			/>,
		);
		const card = container.querySelector("[data-start-card]");

		expect(
			[...(card?.children ?? [])].map((child) => ({
				testid: child.getAttribute("data-testid"),
				setup: child.hasAttribute("data-start-card-setup"),
			})),
		).toStrictEqual([
			{testid: "start-card-clawd", setup: false},
			{testid: null, setup: true},
		]);
	});

	it("renders nothing without folders", () => {
		const {container} = render(<StartCard projects={[]} selected={undefined} onSelect={() => {}} />);

		expect(container.innerHTML).toBe("");
	});

	it("selects a clicked row and focuses the composer", () => {
		const onSelect = vi.fn<(projectId: string) => void>();
		render(
			<>
				<StartCard projects={PROJECTS} selected={PROJECTS[0]} onSelect={onSelect} />
				<FakeComposer />
			</>,
		);

		fireEvent.click(screen.getByRole("button", {name: "p2"}));

		expect({
			calls: onSelect.mock.calls,
			focused: document.activeElement?.getAttribute("aria-label"),
		}).toStrictEqual({calls: [["-users-dev-p2"]], focused: "Prompt"});
	});

	it("shows the current row's shortened cwd in a start-aligned tooltip instead of a title attribute", () => {
		vi.useFakeTimers();
		try {
			const {container} = render(<StartCard projects={PROJECTS} selected={PROJECTS[4]} onSelect={() => {}} />);
			const current = container.querySelector<HTMLElement>("li[aria-current] > span")!;

			fireEvent.pointerEnter(current);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const tooltip = screen.getByRole("tooltip");

			expect({
				titles: container.querySelectorAll("[title]").length,
				text: tooltip.textContent,
				align: tooltip.dataset["align"],
			}).toStrictEqual({titles: 0, text: "~/projects/p5", align: "start"});
		} finally {
			vi.useRealTimers();
		}
	});

	it("insets the divider and keeps the Choose environment row highlighted while its picker is open", async () => {
		const {container} = render(<StartCard projects={PROJECTS} selected={PROJECTS[0]} onSelect={() => {}} />);
		const trigger = screen.getByRole("button", {name: "Choose environment"});

		fireEvent.click(trigger);
		await screen.findByRole("listbox", {name: "Projects"});
		const chevron = trigger.querySelector("svg")!;

		expect({
			divider: container.querySelector<HTMLElement>("li > [aria-hidden].border-t")?.style.marginInline,
			row: trigger.parentElement?.className,
			expanded: trigger.getAttribute("aria-expanded"),
			button: trigger.className,
			chevron: chevron.getAttribute("class"),
		}).toStrictEqual({
			divider: "var(--ring-inner, 1px)",
			row: "group/row relative",
			expanded: "true",
			button: "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-[13px]/5 text-secondary-control outline-none group-hover/row:bg-fill-ghost-hover group-has-[:focus-visible]/row:bg-fill-ghost-hover group-has-[[aria-expanded=true]]/row:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden",
			chevron:
				"lucide lucide-chevron-down size-3 shrink-0 text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary",
		});
	});

	it("opens the project picker from Choose environment and focuses the composer on a pick", async () => {
		const onSelect = vi.fn<(projectId: string) => void>();
		render(
			<>
				<StartCard projects={PROJECTS} selected={PROJECTS[0]} onSelect={onSelect} />
				<FakeComposer />
			</>,
		);

		fireEvent.click(screen.getByRole("button", {name: "Choose environment"}));
		const listbox = await screen.findByRole("listbox", {name: "Projects"});
		fireEvent.click(within(listbox).getByRole("option", {name: "p4"}));

		expect({
			calls: onSelect.mock.calls,
			focused: document.activeElement?.getAttribute("aria-label"),
		}).toStrictEqual({calls: [["-users-dev-p4"]], focused: "Prompt"});
	});

	it("focuses Choose environment when a keyboard dismiss empties Next steps", async () => {
		function Card() {
			const [candidates, setCandidates] = useState<NextStepCandidate[]>([
				{id: "waiting-session", subject: "s1", stamp: 100, title: "Task 1", detail: "Asked a question"},
			]);
			return (
				<StartCard
					projects={PROJECTS}
					selected={PROJECTS[0]}
					onSelect={() => {}}
					nextSteps={{
						rows: selectNextSteps({candidates, dismissed: {}}),
						onOpen: () => {},
						onDismiss: (dismissed) => {
							// Later, like React Query's batched observer update.
							setTimeout(() => {
								setCandidates((previous) => previous.filter((c) => !dismissed.includes(c)));
							}, 50);
						},
					}}
				/>
			);
		}
		render(
			<>
				<Card />
				<FakeComposer />
			</>,
		);
		const x = screen.getByRole("button", {name: "Dismiss “Task 1”"});
		const matches = x.matches.bind(x);
		Object.defineProperty(x, "matches", {
			value: (selector: string) => selector === ":focus-visible" || matches(selector),
		});

		fireEvent.click(x);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 100);
			});
		});

		expect({
			focused: document.activeElement?.textContent,
			nextSteps: screen.queryByRole("list", {name: "Next steps"}),
		}).toStrictEqual({focused: "Choose environment", nextSteps: null});
	});
});

/** The home start card under its launch-folder provider, with p1 the most recently active project. */
function renderHomeStartCard(nextSteps?: Parameters<typeof HomeStartCard>[0]["nextSteps"]) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
	queryClient.setQueryData(
		projectsQueryOptions().queryKey,
		[1, 2].map((n) => ({
			id: `-users-dev-p${n}`,
			name: `p${n}`,
			projectPath: `/Users/dev/projects/p${n}`,
			sessionCount: 1,
			memoryCount: 0,
			planCount: 0,
			taskCount: 0,
			activeCount: 0,
			lastActivity: new Date(Date.UTC(2026, 9, 3 - n)).toISOString(),
		})),
	);
	queryClient.setQueryData(recentSessionsQueryOptions(HOME_RECENT_LIMIT).queryKey, {
		sessions: [],
		nextCursor: null,
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<HomeLaunchFolderProvider>
				<HomeStartCard nextSteps={nextSteps} />
				<FolderChip />
			</HomeLaunchFolderProvider>
		</QueryClientProvider>,
	);
}

/** Stands in for the composer's environment bar: the folder chip and the Worktree chip on the shared state. */
function FolderChip() {
	const {projects, selected, select} = useHomeLaunchFolder();
	const worktree = useHomeWorktree();
	return (
		<>
			<ProjectPicker projects={projects} selected={selected} onSelect={select} />
			<WorktreeToggleChip on={worktree.enabled} pending={false} onChange={worktree.set} onPressed={() => {}} />
		</>
	);
}

/** The current row's folder name, without its sr-only path. */
function currentFolder() {
	const list = screen.getByRole("list", {name: "Recent folders"});
	return list.querySelector("li[aria-current] span.truncate")?.textContent ?? null;
}

describe("home launch-folder request", () => {
	it("selects a folder requested before home mounts, once", () => {
		requestHomeLaunchFolder("-users-dev-p2");
		const first = renderHomeStartCard();
		const requested = currentFolder();
		first.unmount();
		renderHomeStartCard();

		expect({requested, next: currentFolder()}).toStrictEqual({requested: "p2", next: "p1"});
	});

	it("selects a folder requested while home is mounted", () => {
		renderHomeStartCard();
		const before = currentFolder();
		act(() => {
			requestHomeLaunchFolder("-users-dev-p2");
		});

		expect({before, after: currentFolder()}).toStrictEqual({before: "p1", after: "p2"});
	});
});

describe("Next steps Dismiss at comfortable density", () => {
	it("grows the Dismiss button to upstream's comfortable 32px square with a 20px icon (coarse pointer)", () => {
		const candidate: NextStepCandidate = {
			id: "worktree-apart",
			kind: "worktree",
			subject: "/Users/dev/projects/p1",
			stamp: 0,
			title: "Turn on Worktree",
			detail: "Session running here",
			tooltipText: "Worktree",
			dismissLabel: "Dismiss the Worktree suggestion",
		};
		renderHomeStartCard({
			rows: selectNextSteps({candidates: [candidate], dismissed: {}}),
			onOpen: () => {},
			onDismiss: () => {},
		});
		const dismiss = screen.getByRole("button", {name: "Dismiss the Worktree suggestion"});
		const comfortable = (element: Element | null) =>
			(element?.getAttribute("class") ?? "").split(" ").filter((name) => name.startsWith("comfortable:"));

		expect({button: comfortable(dismiss), icon: comfortable(dismiss.querySelector("svg"))}).toStrictEqual({
			button: ["comfortable:size-8", "comfortable:rounded-r6"],
			icon: ["comfortable:size-5"],
		});
	});
});

describe("Next steps Turn on Worktree", () => {
	const worktreeApart: NextStepCandidate = {
		id: "worktree-apart",
		kind: "worktree",
		subject: "/Users/dev/projects/p1",
		stamp: 0,
		title: "Turn on Worktree",
		detail: "Session running here",
		tooltipText:
			"Another session is running in this folder. Worktree gives this session its own copy, so their changes stay apart.",
		dismissLabel: "Dismiss the Worktree suggestion",
	};

	it("flips the environment bar's Worktree chip on and stores the preference", () => {
		const storage = installLocalStorage();
		renderHomeStartCard({
			rows: selectNextSteps({candidates: [worktreeApart], dismissed: {}}),
			onOpen: () => {},
			onDismiss: () => {},
		});

		fireEvent.click(screen.getByRole("button", {name: /Turn on Worktree/}));

		expect({
			checked: screen.getByRole("switch", {name: "Worktree"}).getAttribute("aria-checked"),
			stored: storage.getItem(HOME_WORKTREE_STORAGE_KEY),
		}).toStrictEqual({checked: "true", stored: "true"});
	});
});
