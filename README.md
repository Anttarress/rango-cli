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
rango quote --from BSC.BNB --to ETH.USDC--0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 --amount 0.1
```

Or without installing: `npx @rango-dev/cli chains`.

## API key

Every endpoint needs a key, issued by the Rango team on
[Discord](https://discord.gg/q3EngGyTrZ). Give it to the CLI in one of three ways,
highest priority first:

```bash
rango chains --api-key <key>        # this run only
export RANGO_API_KEY=<key>          # this shell
rango auth set <key>                # stored in ~/.config/rango/config.json, mode 600
```

`rango auth show` tells you which one is in use. `rango auth test` makes one request to
check it. The key travels as a query parameter, so the CLI refuses any API URL that is
not `https`.

## Commands

| Command | What it does |
|---|---|
| `rango chains [--type EVM] [--all]` | Every supported blockchain |
| `rango chain <name>` | One chain: address patterns, fee assets, explorer |
| `rango tokens <chain> [--search txt] [--popular]` | Tokens on one chain, with decimals and addresses |
| `rango token <chain> <symbol\|address>` | One token; falls back to the custom-token endpoint |
| `rango swappers [--type BRIDGE]` | DEXs, bridges and aggregators Rango routes through |
| `rango quote --from A --to B --amount N` | Best route, output, fees, ETA, and a `requestId` |
| `rango swap … --from-address 0x…` | The unsigned transaction (plus approval if needed) |
| `rango status <requestId> <txHash> [--watch]` | Track a swap until `success` or `failed` |
| `rango approval <requestId> <txHash>` | Has an approval transaction confirmed? |
| `rango balance <chain> <address> [--token X]` | Wallet balances |
| `rango report <requestId> --event USER_REJECT` | Tell Rango a wallet rejected or failed |
| `rango health` | API reachable, key accepted, latency |
| `rango route --from-chain A --to-chain B --amount N` | Best multi-step route (Main API) with its steps |
| `rango basic <op>` / `rango main <op>` | Every API operation, flags generated from its schema (29 in all) |
| `rango schema <surface> <op>` / `rango map` | An operation's input schema; every command and tool |
| `rango mcp` | Serve the same 29 operations as MCP tools over stdio |
| `rango agent setup` | Wire the MCP server and the Rango skill into Claude Code, Cursor or Codex |
| `rango api <path> [-p k=v] [-d json]` | Any other endpoint, key attached, JSON out |

`rango <command> --help` shows every flag with examples.

### Assets and amounts

Assets use Rango's notation: `BLOCKCHAIN.SYMBOL` for native coins, `BLOCKCHAIN.SYMBOL--ADDRESS`
for tokens. `rango chains` gives the blockchain names (`BSC`, `ETH`, `ARBITRUM`,
`AVAX_CCHAIN`, `SOLANA`, …) and `rango tokens <chain>` gives symbols, addresses and decimals.

`--amount` accepts the token's smallest unit as an integer (`1000000` for 1 USDC) or a
decimal (`1.5`), which the CLI converts using the token's decimals from Rango's metadata.

### The swap flow

```bash
rango quote --from BSC.BNB --to ETH.USDC--0xa0b8… --amount 0.1          # 1. is there a route?
rango swap  --from BSC.BNB --to ETH.USDC--0xa0b8… --amount 0.1 \
            --from-address 0xYOU --json > tx.json                     # 2. unsigned tx
# 3. sign tx.json's "tx" with your wallet. If it carries approveTo/approveData,
#    sign that first and wait for:
rango approval <requestId> <approveTxHash>
# 4. then run swap again and sign the main transaction. Track it:
rango status <requestId> <txHash> --watch
```

`rango swap` shows the recipient address in bold before anything else. Check it. A swap
cannot be reversed once signed.

## Multi-step routes (Main API)

When no single swapper connects two assets, the Main API chains several. Amounts
here are human-readable decimals, not the smallest unit.

```bash
rango route --from-chain ETH --from-token USDC --to-chain OSMOSIS --to-token OSMO \
            --amount 100 --wallets '{"ETH":"0x…","OSMOSIS":"osmo1…"}'
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
  it and `--compact` puts it on one line. `rango chains | jq '.[].name'` just works.
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
