// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useEffect, useRef, useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {HOME_RECENT_LIMIT, HomeLaunchFolderProvider} from "../src/components/home/launch-folder";
import {HomeStartCard, StartCard} from "../src/components/home/start-card";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {onHomeComposerFocusRequest, requestHomeLaunchFolder} from "../src/lib/home-composer-focus";
import {selectNextSteps, type NextStepCandidate} from "../src/lib/home-next-steps";
import type {StartProject} from "../src/lib/palette-start-session";

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
	const list = screen.getByRole("list", {name: "Recent environments"});
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
			{text: "p1", current: null, title: "~/projects/p1", button: "p1", check: false},
			{text: "p2", current: null, title: "~/projects/p2", button: "p2", check: false},
			{text: "p5", current: "true", title: "~/projects/p5", button: null, check: true},
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
			{text: "p2", current: "true"},
			{text: "p3", current: null},
			{text: "Choose environment", current: null},
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
function renderHomeStartCard() {
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
				<HomeStartCard />
			</HomeLaunchFolderProvider>
		</QueryClientProvider>,
	);
}

function currentFolder() {
	return rows().find((row) => row.current !== null)?.text ?? null;
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
