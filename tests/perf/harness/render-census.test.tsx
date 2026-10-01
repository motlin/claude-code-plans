// @vitest-environment jsdom

import {cleanup, fireEvent, screen} from "@testing-library/react";
import {createContext, memo, type ReactNode, useContext, useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {measureInteraction} from "./measure-interaction";
import {createRenderCensus} from "./render-census";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const ThemeContext = createContext("light");

function ThemeProvider({children}: {children: ReactNode}) {
	return <ThemeContext value="dark">{children}</ThemeContext>;
}

function Themed() {
	return <span>{useContext(ThemeContext)}</span>;
}

const Pure = memo(function Pure() {
	return <Themed />;
});

function Count({value}: {value: number}) {
	return <output>{value}</output>;
}

function Counter() {
	const [count, setCount] = useState(0);
	return (
		<div>
			<button type="button" onClick={() => setCount((value) => value + 1)}>
				add
			</button>
			<Count value={count} />
			{count > 1 && <Themed />}
			<Pure />
		</div>
	);
}

describe("createRenderCensus", () => {
	it("records the components each step rendered, skipping memoized bailouts, and counts context consumers", async () => {
		const census = createRenderCensus();
		const click = () => {
			fireEvent.click(screen.getByRole("button"));
		};

		await measureInteraction(
			() => (
				<census.Root>
					<ThemeProvider>
						<Counter />
					</ThemeProvider>
				</census.Root>
			),
			[
				() => {
					census.startStep();
					click();
				},
				() => {
					census.startStep();
					click();
				},
			],
			{fixtures: {}},
		);
		census.stop();

		expect({
			steps: census.steps(),
			distinct: census.steps().map((step) => Object.keys(step).length),
			consumers: census.contextConsumers(ThemeProvider),
		}).toStrictEqual({
			steps: [
				{Count: 1, Counter: 1},
				{Count: 1, Counter: 1, Themed: 1},
			],
			distinct: [2, 3],
			consumers: 2,
		});
	});
});
