# `just --list --unsorted`
[group('default')]
default:
    @just --list --unsorted

ci := env("CI", "")
_ci := if ci != "" { ":ci" } else { "" }
port := "7526"

# `npm install` or `npm ci`
[group('setup')]
install:
    {{ if ci != "" { "npm ci" } else { "npm install" } }}

# Run dev server with Vite (wrapped by Spotlight sidecar)
dev *args: install
    PORT={{port}} npx @spotlightjs/spotlight run npm run dev {{args}}

# Run production server
start *args: install build
    PORT={{port}} npm run start {{args}}

# Run Oxlint
oxlint: install
    npm run oxlint{{_ci}}

# Run Oxfmt formatter
fmt: install
    npm run fmt{{_ci}}

# Run all formatters
format: fmt

# Run tests
test *args: install
    npm run test:run {{args}}

# Type-check the project (build first to generate routeTree.gen.ts)
typecheck: install build
    npm run typecheck

# Build the project
build: install
    npm run build

# Run Storybook dev server
storybook: install
    npm run storybook

# Build static Storybook site
build-storybook: install
    npm run build-storybook

# Run fallow (build first to generate routeTree.gen.ts)
fallow: build
    npm run fallow
    npm run fallow:ci

# Run all pre-commit checks
[arg("quick", long, value="true", help="Skip tests")]
precommit quick="": oxlint format build typecheck fallow
    {{ if quick != "true" { "just test" } else { "true" } }}
    @echo "All pre-commit checks passed!"
