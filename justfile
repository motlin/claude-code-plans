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

# Run ESLint
eslint: install
    npm run eslint{{_ci}}

# Run Biome formatter
biome: install
    npm run biome{{_ci}}

# Run all formatters
format: biome

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

# Run fallow
fallow: install
    npm run fallow{{_ci}}

# Run all pre-commit checks
[arg("quick", long, value="true", help="Skip tests")]
precommit quick="": eslint format build typecheck fallow
    {{ if quick != "true" { "just test" } else { "true" } }}
    @echo "All pre-commit checks passed!"

# Install launchd service
launchd-install:
    mkdir -p ~/Library/Logs/claude-code-plans
    cp launchd/com.craig.claude-code-plans.plist ~/Library/LaunchAgents/
    launchctl load ~/Library/LaunchAgents/com.craig.claude-code-plans.plist

# Uninstall launchd service
launchd-uninstall:
    launchctl unload ~/Library/LaunchAgents/com.craig.claude-code-plans.plist
    rm ~/Library/LaunchAgents/com.craig.claude-code-plans.plist

# View server logs
logs:
    tail -f ~/Library/Logs/claude-code-plans/stdout.log
