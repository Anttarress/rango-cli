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
| `rango basic token <chain> <symbol\|address>` / `rango basic tokens <chain>` | One token (falls back to the custom-token endpoint), or every token on a chain; also under `rango main` |
| `rango schema <surface> <op>` / `rango map` | The fields an operation takes and returns; every command and tool |
| `rango mcp` | Run the Rango MCP server on this machine (stdio) |
| `rango agent setup` | Connect Claude Code, Cursor or Codex to the Rango MCP server and install the Rango skill |
| `rango api <path> [-p k=v] [-d json]` | Any other endpoint, key attached, JSON out |
| `rango auth` | Manage the API key |

`rango <command> --help` shows every flag with examples.

### Assets and amounts

Assets use Rango's notation: `BLOCKCHAIN.SYMBOL` for native coins, `BLOCKCHAIN.SYMBOL--ADDRESS`
for tokens. `rango basic chains` gives the blockchain names (`BSC`, `ETH`, `ARBITRUM`,
`AVAX_CCHAIN`, `SOLANA`, …) and `rango basic token <chain> <symbol>` resolves one token to its
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

The Rango MCP server offers every operation in the catalogue as a tool, with
`readOnlyHint` set honestly: `basic_swap` and `main_create_tx` build calldata,
nothing signs. It can run in two places, with the same tools:

- **On your machine.** `rango mcp` serves it over stdio and reads your API key the
  way every command does. This is what setup registers by default.
- **Hosted.** `rango agent setup --mcp-url <url>` points your agents at a hosted
  Rango MCP server instead. Only the URL is written.

One command connects the agents on your machine:

```bash
rango agent setup               # pick agents from a menu
rango agent setup --status      # what is detected and configured
rango agent setup -y            # every detected agent, no questions
```

On a terminal, `rango agent setup` lists the agents it found and what state each is
in. Move with the arrow keys, press space to check or uncheck a row and enter to
set up the checked ones; `q` leaves without changing anything. Agents that are
already set up start unchecked.

Claude Code gets the server through `claude mcp add --scope user rango …` and the
skill in `~/.claude/skills/rango`; Cursor gets an entry merged into
`~/.cursor/mcp.json`; Codex gets `[mcp_servers.rango]` in `~/.codex/config.toml`.
An agent that already points at the other server is switched, `--local` asks for
the local one, and `rango agent setup --status` shows which server each agent
uses. The API key is never written into an agent's config. Any other MCP client,
for the local server:

```json
{ "mcpServers": { "rango": { "command": "rango", "args": ["mcp"] } } }
```

### The skills

The skills are not part of this CLI. They live in their own repository,
[Anttarress/rango-skills](https://github.com/Anttarress/rango-skills): `SKILL.md`
is what an agent loads (flows, approvals, speed versus cost, tracking and
recovery, errors, a pre-signing checklist), and `references/REFERENCE.md` is the
REST reference with code samples that it reads only when writing code.

`rango agent setup` downloads them from that repository each time it runs, so it
installs the current ones and reports an installed copy as out of date when the
repository has moved on. That needs the network: when the download fails, setup
says so and writes nothing, and `--mcp-only` sets up the MCP server alone.
Without the CLI the same skills install with:

```bash
npx skills add Anttarress/rango-skills
```

Setup copies the skills into each agent's own skills folder. Two more options:

- **A shared folder.** "Install Rango skills" in the menu, or `--client shared`,
  puts the skills in `.agents/skills`, in your home folder or in this project
  (`--scope local`). Codex, Cursor, Gemini CLI, GitHub Copilot and other agents
  read that folder in a project.
- **Another source.** `--skills-url <url of an index.json>` installs what that
  index lists instead: a fork of the skills repository, or a site that serves the
  same layout under `/.well-known/skills/`.

Because the skills name commands, flags and MCP tools of this CLI, the two are
tested together: with the skills repository cloned next to this one (or its
`skills` folder named by `RANGO_SKILLS_DIR`), `pnpm test` checks everything the
skills name against the CLI. CI does that on every change here and once a day.

## Scripting and agents

- **JSON when piped.** Any command prints JSON when stdout is not a terminal; `--json` forces
  it and `--compact` puts it on one line. `rango basic chains | jq '.[].name'` just works.
- **Errors on stderr**, as JSON in JSON mode, never mixed into stdout.
- **Exit codes:** `0` ok, `1` general, `2` bad arguments, `3` key missing or rejected,
  `4` API error (no route, input limits, server), `5` network error.
- **No prompts** when stdin is not a terminal, or with `--no-input`: a missing flag is exit 2.
- **Every operation has a command.** `rango basic <op>` and `rango main <op>` are
  generated from one catalogue, the same one `rango mcp` serves; `rango map` lists them
  all. `rango api` reaches anything else, such as the explorer (`/scanner/*`).
- **Every operation has a schema.** `rango schema basic quote` lists the fields it takes
  and the fields it returns, a line each with type and description: a table on a terminal,
  JSON Schema when piped. The output side is Rango's API reference, one level of nesting
  deep; `--depth 2` shows more.
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
node dist/rango.js basic chains
pnpm test           # vitest, no network: fetch is mocked
pnpm lint && pnpm typecheck
pnpm sync:openapi   # refresh what `rango schema` shows as output, from api-docs.rango.exchange
```

Releases: tag `vX.Y.Z` on `main`; the publish workflow builds and publishes to npm with
provenance. Node 20 or newer.

## License

MIT
