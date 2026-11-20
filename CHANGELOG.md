# Changelog

## Unreleased

- `rango schema <surface> <op>` reads like a page of Rango's API reference: a line per field
  with its type, a `*` when required and its description, first for what the operation takes
  and then for what it returns. The output fields are new and come from that reference
  (`src/catalog/responses.json`, rebuilt with `pnpm sync:openapi`), one level of nesting
  deep; `--depth <n>` shows more. Piped or with `--json` it prints the same as JSON Schema,
  a field per line: `output` is now that schema instead of a sentence, and `method`, `path`
  and `reference` are added.
- `rango agent setup` on a terminal opens a checkbox menu of the detected agents, modelled
  on `stripe agent setup`: arrow keys move, space toggles, enter sets up the checked agents,
  `q` cancels. Each row shows whether the agent is already set up, and the result is one
  line per agent. `--client`, `-y` and non-terminal runs behave as before.
- `rango agent setup` no longer assumes the MCP server runs on the user's machine.
  `--mcp-url <url>` registers a hosted Rango MCP server (only the URL is written), `--local`
  the one this CLI runs (`rango mcp`), and an agent that points at the other one is switched.
  Local stays the default until `HOSTED_MCP_URL` in `src/core/constants.ts` is filled in.
- `rango agent setup --status` reports which server each agent uses: `mcp` is now `none`,
  `local`, `hosted` or `unknown`, and `server` (formerly `launch`) is what setup would register.
  Per agent, `skill` is now `missing`, `outdated`, `current` or `unknown` (it was a boolean),
  and `skills` says where the skills come from and the state of the shared folder.
- The skills moved to their own repository, https://github.com/Anttarress/rango-skills, which
  is their only copy; this repository no longer has a `skills/` folder. `rango agent setup`
  downloads them from there each time it runs, reports an installed copy as out of date when
  the repository has a newer one, and when the download fails stops with exit code 5 before
  writing anything (`--mcp-only` does not need them). `npx skills add Anttarress/rango-skills`
  installs the same files without the CLI.
- `rango agent setup` offers "Install Rango skills" (or `--client shared`), which writes to
  the shared `.agents/skills` folder in the project or the home folder, as `stripe agent
  setup` does, and `--skills-url` installs what another index lists.
- The Rango skill is rewritten after comparing it with the LI.FI and Across skills. It adds
  approvals, a speed-versus-cost rule (`main best-routes` and its `FASTEST` / `LOWEST_FEE`
  tags), a tracking-and-recovery table, error codes with what to do about each, and a longer
  pre-signing checklist. REST details and runnable Node and Python samples moved to
  `references/REFERENCE.md`, which is installed with the skill.
- The skill no longer recommends `--centralized`, a flag that does not exist. Tests now check
  every command, flag, tool and endpoint the skills name against the CLI, from a checkout of
  the skills repository (`RANGO_SKILLS_DIR`, or the repository cloned next to this one); CI
  runs them on every change and once a day.
- `basic_status` says which `requestId` to pass: the one `swap` returned.
- Help and docs name `rango basic token` where they still said `rango token`.

## 0.1.0 - 2026-11-18

First release.

- Two API surfaces as top-level groups: `rango basic <op>` (13 single-step operations)
  and `rango main <op>` (15 multi-step routing operations), generated from one catalogue.
- `basic` and `main` also expose `tokens <chain>` (list) and `token <chain> <sym|addr>`
  (symbol-or-address resolver with a `custom-token` fallback), registered as non-generated
  conveniences on each surface.
- Infrastructure commands: `auth` (`show` / `test` / `set` / `unset`; `test` reports blockchains
  visible and request latency), `api` (escape hatch), `map` (full command/tool listing with
  non-generated subcommands included), `schema` (per-op input JSON Schema plus an `output`
  section extracted from the operation description), `mcp` (serves 28 tools over stdio), and
  `agent setup` (configures Claude Code, Cursor and Codex; `--client` accepts multiple
  comma-separated or repeated values).
- `rango <cmd> help` works as an alias for `rango <cmd> --help` on every command, including
  leaves (e.g. `rango basic quote help`).
- Every generated command prints an example invocation under `--help`.
- JSON when piped, `--json` and `--compact` on a terminal.
- Exit codes 0 to 5; errors on stderr.
- Key from `--api-key`, `RANGO_API_KEY`, or `rango auth set`.
- Never signs or broadcasts.
- `rango agent setup`: configures Claude Code, Cursor and Codex with the MCP server and
  the bundled skill (`skills/rango/SKILL.md`).
