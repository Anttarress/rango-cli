# Changelog

## 0.1.0 (unreleased)

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
