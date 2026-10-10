<p align="center">
  <img src="./docs/images/overview.webp" alt="Seven focused instruments connected around a terminal core" width="100%">
</p>

<h1 align="center">Pi Package Mono</h1>

<p align="center">
  Seven focused extensions for <a href="https://pi.dev">Pi</a>: background processes, an optional shell timeout cap, image generation, model configuration, delegated subagents, delegated vision, and web access.
</p>

<p align="center">
  <a href="https://github.com/ByteTrue/pi-package-mono/actions/workflows/ci.yml"><img src="https://github.com/ByteTrue/pi-package-mono/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
</p>

Each package is independent. Install one capability without inheriting a framework, a shared runtime, or the prompt cost of unrelated tools.

> [!TIP]
> You do not need the whole monorepo. Pick the package that solves the task in front of you.

## Choose a package

| You want Pi to… | Package | What it adds | First step |
| --- | --- | --- | --- |
| Keep a server, watcher, or long task running | [`@bytetrue/pi-background-terminal`](packages/pi-background-terminal) | `background_run`, `background_status`, `background_kill`, `/background` | Install and ask Pi to run a command without hanging on it |
| Cap runaway foreground `bash`/`powershell` commands at 300s (optional) | [`@bytetrue/pi-bash-timeout`](packages/pi-bash-timeout) | 300s default + cap + timeout-error steering for the built-in shell tools | Install and keep working — nothing to invoke |
| Generate or edit images | [`@bytetrue/pi-image-gen`](packages/pi-image-gen) | On-demand Skill + CLI, `/image-gen` setup | Run `/image-gen` |
| Delegate subtasks to child agents | [`@bytetrue/pi-subagent`](packages/pi-subagent) | `subagent`, `subagent_status`, `subagent_stop`, `/subagent` | Ask Pi to run a focused task in an isolated session |
| Manage custom providers and models | [`@bytetrue/pi-vendor`](packages/pi-vendor) | AI-first Skill + cold-start `/vendor` wizard | Ask Pi to update `models.json`, or run `/vendor` |
| Let a text-only model understand images | [`@bytetrue/pi-vision`](packages/pi-vision) | `image_ask`, optional attachment analysis, `/vision` | Run `/vision` |
| Search the web and fetch pages safely | [`@bytetrue/pi-web-search`](packages/pi-web-search) | `web_search`, `web_fetch`, `/web` setup | Search immediately, or run `/web` |

## Install

Install any package from npm:

```bash
pi install npm:@bytetrue/pi-background-terminal
pi install npm:@bytetrue/pi-bash-timeout
pi install npm:@bytetrue/pi-image-gen
pi install npm:@bytetrue/pi-subagent
pi install npm:@bytetrue/pi-vendor
pi install npm:@bytetrue/pi-vision
pi install npm:@bytetrue/pi-web-search
```

Restart or reload Pi after installation. Each package README covers its own setup and behavior.

> [!IMPORTANT]
> Pi tool names must be unique. Before installing `pi-web-search`, remove any extension that already registers `web_search` or `web_fetch`.

## How the packages fit Pi

The repository keeps high-frequency and low-frequency capabilities separate:

- **Agent tools** stay small and explicit: background terminal, delegated vision, subagent delegation, and web access.
- **Skills load on demand** for lower-frequency work: image generation and model configuration.
- **TUI commands close the setup loop**: `/background`, `/image-gen`, `/subagent`, `/vendor`, `/vision`, and `/web`.
- **No package depends on another package here.** Install, upgrade, or remove each one independently.
- **No package replaces Pi's built-in tools.** Background terminal, for example, complements `bash` rather than overriding it.

## Local development

This is an npm workspace monorepo:

```bash
npm ci
npm test
npm run typecheck --workspaces --if-present
```

Run a single package in isolation:

```bash
npm --workspace @bytetrue/pi-web-search test
npm --workspace @bytetrue/pi-web-search run typecheck
```

Load a checkout directly while developing:

```bash
pi install "$PWD/packages/pi-web-search"
```

`pi-image-gen` is the only package with a build step because its extension and bundled Skill CLI share compiled production code:

```bash
npm --workspace @bytetrue/pi-image-gen run build
```

## Repository map

```text
packages/
  pi-background-terminal/  Pure background execution: hands-off tasks with exit notifications
  pi-bash-timeout/         Optional 300s default-and-cap for built-in bash/powershell
  pi-image-gen/            Image generation and editing
  pi-subagent/             Delegated subagents for focused child sessions
  pi-vendor/               models.json provider/model management
  pi-vision/               Vision delegation for text-only models
  pi-web-search/           Search providers and safe page fetching
byissue/spec/           Current architecture and project decisions
```

For AI coding agents working in this repository, [AGENTS.md](AGENTS.md) covers the build/test commands, per-package notes, and commit/PR conventions.

For package-specific installation, configuration, examples, and limits, follow the links in [Choose a package](#choose-a-package).
