# Rango CLI

> **Read-only by design.** This CLI never signs or broadcasts. `rango swap` returns an
> unsigned transaction that your wallet signs and sends.

A TypeScript command-line interface for the [Rango Exchange](https://rango.exchange) API:
cross-chain and same-chain swaps and bridges across 100+ blockchains, aggregated from
dozens of DEXs and bridges. Built for people at a terminal and for AI agents in a
subprocess: tables on a TTY, JSON when piped, stable exit codes, one dependency.

```bash
npm install -g @rango-dev/cli
rango auth set <your-api-key>
rango basic quote --from BSC.BNB --to ETH.USDC--0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 --amount 100000000000000000
```

Or without installing: `npx @rango-dev/cli basic chains`.

## API key

Every endpoint needs a key, issued by the Rango team on
[Discord](https://discord.gg/q3EngGyTrZ). Give it to the CLI in one of three ways,
highest priority first:

```bash
rango basic chains --api-key <key>  # this run only
export RANGO_API_KEY=<key>          # this shell
rango auth set <key>                # stored in ~/.config/rango/config.json, mode 600
```

### Is a key configured?

```bash
rango auth show   # Prints the source (env / config / flag) and a masked key, or "(not set)".
rango auth test   # Makes one cheap request; reports blockchains visible, latency, and the API URL.
```

`auth show` only inspects local state — it never leaves the machine. `auth test` actually hits
the API, so it's the one to use when you want to verify that the key is accepted. It exits 3 if
no key is configured or the API rejects it. Scripts can parse `rango auth show --json`:

```bash
if [ "$(rango auth show --json | jq -r .configured)" != "true" ]; then
  echo "Set a key with: rango auth set <key>"
fi
```

The key travels as a query parameter, so the CLI refuses any API URL that is not `https`.

## Commands

The CLI is two surfaces — `rango basic <op>` for single-step swaps and
`rango main <op>` for multi-step routing — plus a handful of infrastructure commands.

| Command | What it does |
|---|---|
| `rango basic <op>` | Single-step swaps: `quote`, `swap`, `status`, `check-approval`, `balance`, `token-balance`, `chains`, `swappers`, `meta`, `messaging-protocols`, `custom-token`, `connected-assets`, `report-tx` (13 ops) |
| `rango main <op>` | Multi-step routing: `best-route`, `best-routes`, `confirm-route`, `create-tx`, `check-tx-status`, `check-approval`, `meta`, `compact-meta`, `blockchains`, `swappers`, `custom-token`, `contracts`, `token-balance`, `multiple-token-balance`, `report-tx` (15 ops) |
| `rango token <chain> <symbol\|address>` | One token; falls back to the custom-token endpoint |
| `rango schema <surface> <op>` / `rango map` | An operation's input schema; every command and tool |
| `rango mcp` | Serve the operations as MCP tools over stdio |
| `rango agent setup` | Wire the MCP server and the Rango skill into Claude Code, Cursor or Codex |
| `rango api <path> [-p k=v] [-d json]` | Any other endpoint, key attached, JSON out |
| `rango auth` | Manage the API key |

`rango <command> --help` shows every flag with examples.

### Assets and amounts

Assets use Rango's notation: `BLOCKCHAIN.SYMBOL` for native coins, `BLOCKCHAIN.SYMBOL--ADDRESS`
for tokens. `rango basic chains` gives the blockchain names (`BSC`, `ETH`, `ARBITRUM`,
`AVAX_CCHAIN`, `SOLANA`, …) and `rango token <chain> <symbol>` resolves one token to its
address and decimals.

Amounts differ by surface:
- **Basic:** smallest unit as an integer string (`1000000` for 1 USDC).
- **Main:** human-readable decimal string (`"1.5"`). Mixing them is the most common mistake.

### Single-step flow (Basic)

```bash
rango basic quote --from BSC.BNB --to ETH.USDC--0xa0b8… --amount 100000000000000000   # 1. is there a route?
rango basic swap  --from BSC.BNB --to ETH.USDC--0xa0b8… --amount 100000000000000000 \
                  --from-address 0xYOU --to-address 0xYOU --slippage 0.5 > tx.json    # 2. unsigned tx
# 3. sign tx.json's "tx" with your wallet. If it carries approveTo/approveData,
#    sign that first and wait for:
rango basic check-approval --request-id <id> --tx-id <approveTxHash>
# 4. then run swap again and sign the main transaction. Track it:
rango basic status --request-id <id> --tx-id <txHash>
```

Nothing in the CLI signs or broadcasts; `rango basic swap` returns calldata for a wallet.
**Check the `toAddress` before signing — a swap cannot be reversed.**

### Multi-step flow (Main)

When no single swapper connects two assets, the Main API chains several. Amounts are
human-readable decimals, not the smallest unit.

```bash
rango main best-route --from-blockchain ETH --from-symbol USDC \
                      --to-blockchain OSMOSIS --to-symbol OSMO --amount 100 \
                      --selected-wallets '{"ETH":"0x…","OSMOSIS":"osmo1…"}'
rango main confirm-route --request-id <id> --selected-wallets '{"ETH":"0x…","OSMOSIS":"osmo1…"}'
rango main create-tx --request-id <id> --step 1          # sign, then
rango main check-tx-status --request-id <id> --tx-id <hash> --step 1
```

## MCP server and agent setup

The CLI doubles as an MCP server. `rango mcp` serves every operation in the
catalogue as a tool over stdio, with `readOnlyHint` set honestly: `basic_swap`
and `main_create_tx` build calldata, nothing signs. One command configures the
agents on your machine:

```bash
rango agent setup --status      # what is detected and configured
rango agent setup -y            # Claude Code, Cursor, Codex: MCP server + skill
```

Claude Code gets `claude mcp add --scope user rango -- rango mcp` and the skill in
`~/.claude/skills/rango`; Cursor gets an entry merged into `~/.cursor/mcp.json`;
Codex gets `[mcp_servers.rango]` appended to `~/.codex/config.toml`. The API key is
never written into an agent's config: `rango mcp` reads it the same way every
command does. Any other MCP client:

```json
{ "mcpServers": { "rango": { "command": "rango", "args": ["mcp"] } } }
```

The skill itself lives at [skills/rango/SKILL.md](skills/rango/SKILL.md) and also
installs with `npx skills add Anttarress/rango-cli`.

## Scripting and agents

- **JSON when piped.** Any command prints JSON when stdout is not a terminal; `--json` forces
  it and `--compact` puts it on one line. `rango basic chains | jq '.[].name'` just works.
- **Errors on stderr**, as JSON in JSON mode, never mixed into stdout.
- **Exit codes:** `0` ok, `1` general, `2` bad arguments, `3` key missing or rejected,
  `4` API error (no route, input limits, server), `5` network error.
- **No prompts** when stdin is not a terminal, or with `--no-input`: a missing flag is exit 2.
- **Every operation has a command.** `rango basic <op>` and `rango main <op>` are
  generated from one catalogue, the same one `rango mcp` serves; `rango schema` prints
  an operation's input schema and `rango map` lists them all. `rango api` reaches
  anything else, such as the explorer (`/scanner/*`).
- `rango --help` ends with an agent-guidance block that says all of the above.


## Global options

```
--json            Print JSON even on a terminal
--compact         Single-line JSON (implies --json)
--api-key <key>   Key for this run
--api-url <url>   API base URL (default https://api.rango.exchange)
--no-color        Plain output
--no-input        Never prompt
--verbose         Log requests (key masked) and stack traces to stderr
```

## Development

```bash
git clone https://github.com/Anttarress/rango-cli.git && cd rango-cli
pnpm install
pnpm build          # dist/rango.js, one self-contained file
node dist/rango.js chains
pnpm test           # vitest, no network: fetch is mocked
pnpm lint && pnpm typecheck
```

Releases: tag `vX.Y.Z` on `main`; the publish workflow builds and publishes to npm with
provenance. Node 20 or newer.

## License

MIT
