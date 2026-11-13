import type { Command } from "commander";
import { findOperation } from "../catalog/index.js";
import { action, parseNumber, splitList } from "../core/command.js";
import { ExitCode } from "../core/constants.js";
import { CliError } from "../core/errors.js";
import { formatAmount, formatDuration, keyValue, table } from "../core/format.js";
import { promptIfMissing } from "../core/interactive.js";
import { invoke } from "../core/invoke.js";
import { color, isJsonMode, note, print, printJson } from "../core/output.js";

interface SwapStep {
  swapperId?: string;
  swapperType?: string;
  from?: { symbol?: string; blockchain?: string; decimals?: number };
  to?: { symbol?: string; blockchain?: string; decimals?: number };
  fromAmount?: string;
  toAmount?: string;
  estimatedTimeInSeconds?: number;
  fee?: { amount?: string; asset?: { symbol?: string }; expenseType?: string }[];
}

interface BestRouteResponse {
  requestId?: string;
  requestAmount?: string;
  result?: { outputAmount?: string; resultType?: string; swaps?: SwapStep[] } | null;
  diagnosisMessages?: string[];
  error?: string | null;
}

/** "USDC" is a symbol; "0x…" or anything long is an address. */
function tokenParts(value: string | undefined): { symbol?: string; address?: string } {
  if (!value) return {};
  if (/^0x[0-9a-f]+$/i.test(value) || value.length > 12) return { address: value };
  return { symbol: value.toUpperCase() };
}

export function renderBestRoute(data: BestRouteResponse): string {
  const result = data.result;
  const swaps = result?.swaps ?? [];
  const last = swaps[swaps.length - 1];
  const lines = [
    keyValue([
      ["Result", result?.resultType],
      ["Request id", data.requestId],
      ["Steps", swaps.length],
      [
        "You receive",
        last
          ? `${formatAmount(result?.outputAmount, last.to?.decimals)} ${last.to?.symbol ?? ""}`
          : undefined,
      ],
      ["Est. time", formatDuration(swaps.reduce((sum, s) => sum + (s.estimatedTimeInSeconds ?? 0), 0))],
    ]),
  ];
  if (swaps.length) {
    lines.push("");
    lines.push(
      table(
        ["step", "swapper", "from", "to", "receive", "time"],
        swaps.map((s, i) => [
          String(i + 1),
          s.swapperId ?? "",
          `${s.from?.symbol ?? ""} (${s.from?.blockchain ?? ""})`,
          `${s.to?.symbol ?? ""} (${s.to?.blockchain ?? ""})`,
          `${formatAmount(s.toAmount, s.to?.decimals)} ${s.to?.symbol ?? ""}`,
          formatDuration(s.estimatedTimeInSeconds),
        ]),
      ),
    );
  }
  for (const message of data.diagnosisMessages ?? []) lines.push(color.yellow(`Note: ${message}`));
  return lines.join("\n");
}

export function registerRouteCommand(program: Command): void {
  program
    .command("route")
    .description("Best multi-step route across DEXs and bridges (Main API; no transaction)")
    .option("--from-chain <name>", "Source blockchain, e.g. ETH")
    .option("--from-token <symbolOrAddress>", "Source token; omit for the native coin")
    .option("--to-chain <name>", "Destination blockchain")
    .option("--to-token <symbolOrAddress>", "Destination token; omit for the native coin")
    .option("--amount <decimal>", 'Human-readable amount, e.g. "0.5" (not the smallest unit)')
    .option("--wallets <json>", 'Wallet per blockchain, {"ETH":"0x…","BSC":"0x…"}; needed before confirm')
    .option("--slippage <percent>", "Slippage in percent")
    .option("--swappers <ids>", "Only these swappers, comma-separated")
    .option("--max-steps <n>", "Maximum number of steps")
    .option("--check", "Verify balances and fees (slower)")
    .option("--centralized", "Include centralized swappers")
    .addHelpText(
      "after",
      `
Examples:
  $ rango route --from-chain ETH --from-token USDC --to-chain OSMOSIS --to-token OSMO --amount 100
  $ rango route --from-chain BSC --to-chain ETH --amount 0.5 --wallets '{"BSC":"0xYOU","ETH":"0xYOU"}' --json

Next: rango main confirm-route --request-id <id> --selected-wallets '{...}'
      rango main create-tx --request-id <id> --step 1`,
    )
    .action(
      action(
        async (options: {
          fromChain?: string;
          fromToken?: string;
          toChain?: string;
          toToken?: string;
          amount?: string;
          wallets?: string;
          slippage?: string;
          swappers?: string;
          maxSteps?: string;
          check?: boolean;
          centralized?: boolean;
        }) => {
          const fromChain = await promptIfMissing(options.fromChain, "--from-chain");
          const toChain = await promptIfMissing(options.toChain, "--to-chain");
          const amount = await promptIfMissing(options.amount, "--amount (decimal)");
          const from = tokenParts(options.fromToken);
          const to = tokenParts(options.toToken);
          let selectedWallets: Record<string, string> | undefined;
          if (options.wallets) {
            try {
              selectedWallets = JSON.parse(options.wallets) as Record<string, string>;
            } catch {
              throw new CliError('--wallets must be JSON like {"ETH":"0x…"}', ExitCode.InvalidArgs);
            }
          }
          const op = findOperation("main", "best-route");
          if (!op) throw new CliError("best-route operation missing from the catalogue");
          const data = (await invoke(op, {
            fromBlockchain: fromChain.toUpperCase(),
            fromSymbol: from.symbol,
            fromAddress: from.address,
            toBlockchain: toChain.toUpperCase(),
            toSymbol: to.symbol,
            toAddress: to.address,
            amount,
            selectedWallets,
            slippage: parseNumber("--slippage", options.slippage),
            swappers: splitList(options.swappers),
            maxLength: parseNumber("--max-steps", options.maxSteps),
            checkPrerequisites: options.check ? true : undefined,
            enableCentralizedSwappers: options.centralized ? true : undefined,
          })) as BestRouteResponse;
          if (isJsonMode()) return printJson(data);
          if (!data.result) {
            throw new CliError(data.error ?? "No route found", ExitCode.ApiError, undefined, data);
          }
          if (data.result.resultType && data.result.resultType !== "OK") {
            note(color.yellow(`Warning: ${data.result.resultType}`));
          }
          print(renderBestRoute(data));
        },
      ),
    );
}
