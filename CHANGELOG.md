# Changelog

## 0.1.0 (unreleased)

First release.

- Commands: `chains`, `chain`, `tokens`, `token`, `swappers`, `quote`, `swap`, `status`,
  `approval`, `balance`, `report`, `health`, `auth`, `api`.
- Tables on a terminal, JSON when piped, `--json` and `--compact`.
- Exit codes 0 to 5; errors on stderr.
- Decimal amounts converted through token metadata.
- Key from `--api-key`, `RANGO_API_KEY`, or `rango auth set`.
- Never signs or broadcasts.
- Main API: `route`, and `rango main <op>` for all 16 operations (best routes, confirm,
  per-step transactions, balances).
- One operation catalogue drives `rango basic|main <op>`, `rango schema`, `rango map`
  and the MCP server.
- `rango mcp`: the 29 operations as MCP tools over stdio.
- `rango agent setup`: configures Claude Code, Cursor and Codex with the MCP server and
  the bundled skill (`skills/rango/SKILL.md`).
