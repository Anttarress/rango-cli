import type { Command } from "commander";
import { resolveAmount } from "../core/assets.js";
import { action, parseNumber, splitList } from "../core/command.js";
import { ExitCode } from "../core/constants.js";
import { CliError } from "../core/errors.js";
import { formatAmount, formatDuration, formatUsd, keyValue, table } from "../core/format.js";
import { api, type Params } from "../core/http.js";
import { promptIfMissing } from "../core/interactive.js";
import { color, isJsonMode, note, print, printJson } from "../core/output.js";
import type { QuoteResponse, Route, Token } from "../types/index.js";

export interface RoutingOptions {
  from?: string;
  to?: string;
  amount?: string;
  slippage?: string;
  swappers?: string;
  excludeSwappers?: boolean;
  swapperGroups?: string;
  centralized?: boolean;
  avoidNativeFee?: boolean;
  referrerCode?: string;
  referrerFee?: string;
}

/** Flags shared by quote and swap. */
export function addRoutingOptions(cmd: Command): Command {
  return cmd
    .option("--from <asset>", 'Source asset, e.g. BSC.BNB or ETH.USDC--0xa0b8…  (see "rango tokens")')
    .option("--to <asset>", "Destination asset, same notation")
    .option(
      "--amount <amount>",
      "Smallest unit as an integer (1000000 = 1 USDC) or a decimal (1.5), resolved via the token's decimals",
    )
    .option("--slippage <percent>", "Slippage in percent, 0.01 to 30", "0.5")
    .option("--swappers <ids>", 'Only these swappers, comma-separated ids from "rango swappers"')
    .option("--exclude-swappers", "Treat --swappers as a deny list")
    .option("--swapper-groups <tags>", "Only these swapper groups, comma-separated")
    .option("--centralized", "Include centralized swappers")
    .option(
      "--avoid-native-fee",
      "Skip swappers that charge their fee in the native token (account-abstraction wallets)",
    )
    .option("--referrer-code <code>", "Referrer code for fee sharing")
    .option("--referrer-fee <percent>", "Referrer fee in percent, 0 to 10");
}

export async function routingParams(
  options: RoutingOptions,
): Promise<Params & { from: string; to: string; amount: string }> {
  const from = await promptIfMissing(options.from, "--from (source asset)");
  const to = await promptIfMissing(options.to, "--to (destination asset)");
  const rawAmount = await promptIfMissing(options.amount, "--amount");
  const amount = await resolveAmount(rawAmount, from);
  const slippage = parseNumber("--slippage", options.slippage);
  if (slippage !== undefined && (slippage < 0.01 || slippage > 30)) {
    throw new CliError("--slippage must be between 0.01 and 30 percent", ExitCode.InvalidArgs);
  }
  const swappers = splitList(options.swappers);
  return {
    from,
    to,
    amount,
    slippage,
    swappers: swappers?.join(","),
    swappersExclude: swappers && options.excludeSwappers ? true : undefined,
    swapperGroups: splitList(options.swapperGroups)?.join(","),
    enableCentralizedSwappers: options.centralized ? true : undefined,
    avoidNativeFee: options.avoidNativeFee ? true : undefined,
    referrerCode: options.referrerCode,
    referrerFee: parseNumber("--referrer-fee", options.referrerFee),
  };
}

export function assetLabel(token: Token | undefined): string {
  if (!token) return "?";
  return `${token.symbol} (${token.blockchain})`;
}

/** NO_ROUTE and INPUT_LIMIT_ISSUE are failures with exit code 4; HIGH_IMPACT is a warning. */
export function checkResultType(data: QuoteResponse): void {
  const type = data.resultType ?? (data.route ? "OK" : "NO_ROUTE");
  if (type === "OK") return;
  if (type === "HIGH_IMPACT") {
    note(
      color.yellow(
        "Warning: HIGH_IMPACT. The price impact of this route is high; review the output amount before proceeding.",
      ),
    );
    return;
  }
  const restriction = data.route?.amountRestriction;
  const hint =
    type === "INPUT_LIMIT_ISSUE" && restriction
      ? `The swapper accepts ${restriction.min ?? "?"} to ${restriction.max ?? "?"} (${restriction.type ?? ""}, smallest unit).`
      : type === "NO_ROUTE"
        ? "Try a different amount or pair, or add --centralized."
        : undefined;
  throw new CliError(`${type}${data.error ? `: ${data.error}` : ""}`, ExitCode.ApiError, hint, data);
}

export function renderRoute(data: QuoteResponse, route: Route): string {
  const to = route.to;
  const lines = [
    keyValue([
      ["Result", data.resultType],
      [
        "Route",
        `${assetLabel(route.from)} -> ${assetLabel(to)} via ${route.swapper?.title ?? route.swapper?.id ?? "?"}`,
      ],
      ["You receive", `${formatAmount(route.outputAmount, to?.decimals)} ${to?.symbol ?? ""}`.trim()],
      ["Minimum", `${formatAmount(route.outputAmountMin, to?.decimals)} ${to?.symbol ?? ""}`.trim()],
      ["Value", formatUsd(route.outputAmountUsd)],
      ["Fees", formatUsd(route.feeUsd)],
      ["Est. time", formatDuration(route.estimatedTimeInSeconds)],
      ["Request id", data.requestId],
    ]),
  ];
  const path = route.path ?? [];
  if (path.length > 1) {
    lines.push("");
    lines.push(
      table(
        ["step", "from", "to", "swapper", "expected"],
        path.map((step, i) => [
          String(i + 1),
          assetLabel(step.from),
          assetLabel(step.to),
          step.swapper?.title ?? step.swapper?.id ?? "",
          formatAmount(step.expectedOutput, step.to?.decimals),
        ]),
      ),
    );
  }
  return lines.join("\n");
}

export function registerQuoteCommand(program: Command): void {
  addRoutingOptions(
    program.command("quote").description("Best single-step route for a swap or bridge (no transaction)"),
  )
    .addHelpText(
      "after",
      `
Examples:
  $ rango quote --from BSC.BNB --to ETH.USDC--0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 --amount 0.1
  $ rango quote --from ETH.USDC--0xa0b8… --to ARBITRUM.USDC--0xaf88… --amount 1000000000 --slippage 1 --json
  $ rango quote                      # prompts for the missing flags on a terminal`,
    )
    .action(
      action(async (options: RoutingOptions) => {
        const params = await routingParams(options);
        const data = await api.get<QuoteResponse>("/basic/quote", { params });
        if (isJsonMode()) {
          checkResultTypeQuiet(data);
          return printJson(data);
        }
        checkResultType(data);
        print(renderRoute(data, data.route ?? {}));
        print(
          `\n${color.dim("Next: rango swap with the same flags plus --from-address to build the transaction.")}`,
        );
      }),
    );
}

/** In JSON mode the body is the answer; only hard failures become errors. */
export function checkResultTypeQuiet(data: QuoteResponse): void {
  const type = data.resultType ?? (data.route ? "OK" : "NO_ROUTE");
  if (type === "OK" || type === "HIGH_IMPACT") return;
  checkResultType(data);
}
