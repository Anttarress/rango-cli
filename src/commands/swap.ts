import type { Command } from "commander";
import { action } from "../core/command.js";
import { ExitCode } from "../core/constants.js";
import { CliError } from "../core/errors.js";
import { keyValue } from "../core/format.js";
import { api } from "../core/http.js";
import { promptIfMissing } from "../core/interactive.js";
import { color, isJsonMode, print, printJson } from "../core/output.js";
import type { SwapResponse, SwapTransaction } from "../types/index.js";
import {
  addRoutingOptions,
  checkResultType,
  checkResultTypeQuiet,
  type RoutingOptions,
  renderRoute,
  routingParams,
} from "./quote.js";

interface SwapOptions extends RoutingOptions {
  fromAddress?: string;
  toAddress?: string;
  disableEstimate?: boolean;
  infiniteApprove?: boolean;
  referrerAddress?: string;
}

export function needsApproval(tx: SwapTransaction): boolean {
  return Boolean(tx.approveTo || tx.approveData || tx.approve_payload || tx.approveCalls);
}

function chainName(tx: SwapTransaction): string {
  const chain = tx.blockChain;
  if (!chain) return "";
  return typeof chain === "string" ? chain : (chain.name ?? "");
}

export function renderTx(tx: SwapTransaction): string {
  const rows: [string, unknown][] = [
    ["Tx type", `${tx.type ?? "?"}${chainName(tx) ? ` on ${chainName(tx)}` : ""}`],
    ["From", tx.from],
    ["To", tx.txTo ?? tx.to],
    ["Value", tx.value],
    ["Gas limit", tx.gasLimit],
    ["Calldata", (tx.txData ?? tx.data) ? `${String(tx.txData ?? tx.data).length} chars` : undefined],
    ["Approval", needsApproval(tx) ? "needed first (approveTo / approveData)" : "not needed"],
  ];
  return keyValue(rows);
}

export function registerSwapCommand(program: Command): void {
  addRoutingOptions(
    program
      .command("swap")
      .description("Build the unsigned transaction for a swap. Nothing is signed or sent."),
  )
    .option("--from-address <address>", "Wallet that signs and pays")
    .option("--to-address <address>", "Wallet that receives the output (default: --from-address)")
    .option("--disable-estimate", "Skip the balance and fee checks (faster; only for previews)")
    .option("--infinite-approve", "Ask for an unlimited token allowance instead of the exact amount")
    .option("--referrer-address <address>", "Wallet that receives the referrer fee")
    .addHelpText(
      "after",
      `
Examples:
  $ rango swap --from BSC.BNB --to ETH.USDC--0xa0b8… --amount 0.1 --from-address 0xYOU
  $ rango swap --from BSC.BNB --to ETH.USDC--0xa0b8… --amount 100000000000000000 --from-address 0xYOU --json > tx.json

The response's "tx" is what your wallet signs. If it carries approveTo/approveData, sign that first,
wait for "rango approval <requestId> <txHash>" to report approved, then run this command again.`,
    )
    .action(
      action(async (options: SwapOptions) => {
        const routing = await routingParams(options);
        const fromAddress = await promptIfMissing(options.fromAddress, "--from-address (wallet that signs)");
        const toAddress = options.toAddress ?? fromAddress;
        const params = {
          ...routing,
          slippage: routing.slippage ?? 0.5,
          fromAddress,
          toAddress,
          disableEstimate: options.disableEstimate ? true : undefined,
          infiniteApprove: options.infiniteApprove ? true : undefined,
          referrerAddress: options.referrerAddress,
        };
        const data = await api.get<SwapResponse>("/basic/swap", { params });
        if (isJsonMode()) {
          checkResultTypeQuiet(data);
          if (!data.tx)
            throw new CliError(
              data.error ?? "No transaction was returned",
              ExitCode.ApiError,
              undefined,
              data,
            );
          return printJson(data);
        }
        checkResultType(data);
        if (!data.tx)
          throw new CliError(data.error ?? "No transaction was returned", ExitCode.ApiError, undefined, data);
        print(renderRoute(data, data.route ?? {}));
        print("");
        print(renderTx(data.tx));
        print(`\nRecipient: ${color.bold(toAddress)}`);
        print(
          color.dim(
            "Nothing was signed or sent. Run with --json to get the full transaction for your wallet.",
          ),
        );
        print(color.dim(`Then: rango status ${data.requestId ?? "<requestId>"} <txHash> --watch`));
      }),
    );
}
