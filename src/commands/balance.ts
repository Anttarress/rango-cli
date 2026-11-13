import type { Command } from "commander";
import { action } from "../core/command.js";
import { formatAmount, table } from "../core/format.js";
import { api } from "../core/http.js";
import { isJsonMode, print, printJson } from "../core/output.js";
import type { BalanceResponse, TokenBalanceResponse } from "../types/index.js";

export function renderBalances(data: BalanceResponse): string {
  const parts: string[] = [];
  for (const wallet of data.wallets ?? []) {
    parts.push(`${wallet.blockChain ?? ""} ${wallet.address ?? ""}`.trim());
    if (wallet.failed) {
      parts.push("  (balance fetch failed)");
      continue;
    }
    const rows = (wallet.balances ?? []).map((b) => [
      b.asset?.symbol ?? "",
      formatAmount(b.amount?.amount, b.amount?.decimals),
      b.asset?.address ?? "(native)",
    ]);
    parts.push(table(["symbol", "amount", "address"], rows));
  }
  return parts.join("\n") || "(no wallets)";
}

export function registerBalanceCommand(program: Command): void {
  program
    .command("balance <chain> <address>")
    .description("Token balances of a wallet on one blockchain")
    .option("--token <symbol>", "One token only (uses the faster token-balance endpoint)")
    .option("--token-address <address>", "Contract address of --token; omit for the native coin")
    .addHelpText(
      "after",
      `
Examples:
  $ rango balance ETH 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  $ rango balance BSC 0xYOU --token USDT --token-address 0x55d398326f99059ff775485246999027b3197955`,
    )
    .action(
      action(async (chain: string, address: string, options: { token?: string; tokenAddress?: string }) => {
        const blockchain = chain.toUpperCase();
        if (options.token) {
          const data = await api.get<TokenBalanceResponse>("/basic/token-balance", {
            params: {
              blockchain,
              symbol: options.token.toUpperCase(),
              address: options.tokenAddress,
              walletAddress: address,
            },
          });
          if (isJsonMode()) return printJson(data);
          print(
            `${options.token.toUpperCase()} balance of ${address} on ${blockchain}: ${data.balance ?? "unknown"}${data.error ? ` (${data.error})` : ""}`,
          );
          return;
        }
        const data = await api.get<BalanceResponse>("/basic/balance", { params: { blockchain, address } });
        if (isJsonMode()) return printJson(data);
        print(renderBalances(data));
      }),
    );
}
