# `just --list --unsorted`
[group('default')]
default:
    @just --list --unsorted

ci := env("CI", "")
_ci := if ci != "" { ":ci" } else { "" }
port := "7526"

# `pnpm install` or `pnpm install --frozen-lockfile`
[group('setup')]
install:
    {{ if ci != "" { "pnpm install --frozen-lockfile" } else { "pnpm install" } }}

# Run dev server with Vite (wrapped by Spotlight sidecar)
dev *args: install
    PORT={{port}} pnpm dlx @spotlightjs/spotlight run pnpm run dev {{args}}

# Run production server
start *args: install build
    PORT={{port}} pnpm run start {{args}}

# Run Oxlint
oxlint: install
    pnpm run oxlint{{_ci}}

# Run Oxfmt formatter
fmt: install
    pnpm run fmt{{_ci}}

# Run all formatters
format: fmt

# Run tests
test *args: install
    pnpm run test:run {{args}}

# Type-check the project (build first to generate routeTree.gen.ts)
typecheck: install build
    pnpm run typecheck

# Build the project
build: install
    pnpm run build

# Run Storybook dev server
storybook: install
    pnpm run storybook

# Build static Storybook site
build-storybook: install
    pnpm run build-storybook

# Run fallow (build first to generate routeTree.gen.ts)
fallow: build
    pnpm run fallow
    pnpm run fallow:ci

# Run all pre-commit checks
[arg("quick", long, value="true", help="Skip tests")]
precommit quick="": oxlint format build typecheck fallow
    {{ if quick != "true" { "just test" } else { "true" } }}
    @echo "All pre-commit checks passed!"
