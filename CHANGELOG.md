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
