import type { Command } from "commander";
import { fetchTokens, findToken, parseAsset } from "../core/assets.js";
import { action } from "../core/command.js";
import { invalidArgs } from "../core/errors.js";
import { keyValue, recordsTable } from "../core/format.js";
import { api } from "../core/http.js";
import { isJsonMode, print, printJson } from "../core/output.js";
import type { CustomTokenResponse, Token } from "../types/index.js";

const TABLE_LIMIT = 100;

function tokenRow(t: Token) {
  return {
    symbol: t.symbol,
    name: t.name,
    address: t.address ?? "(native)",
    decimals: t.decimals,
    usdPrice: t.usdPrice,
    popular: t.isPopular,
  };
}

export function registerTokensCommand(program: Command): void {
  program
    .command("tokens <chain>")
    .description("Tokens Rango knows on one blockchain")
    .option("--search <text>", "Only tokens whose symbol or name contains this text")
    .option("--popular", "Only tokens Rango marks as popular")
    .option(
      "--limit <n>",
      `Rows to show in table mode (default ${TABLE_LIMIT}; JSON output is never limited)`,
    )
    .addHelpText(
      "after",
      `
Examples:
  $ rango tokens ETH --search usdc
  $ rango tokens ARBITRUM --popular
  $ rango tokens BSC --json | jq '.[] | select(.symbol=="USDT") | .address'`,
    )
    .action(
      action(async (chain: string, options: { search?: string; popular?: boolean; limit?: string }) => {
        const blockchain = chain.toUpperCase();
        let tokens = await fetchTokens(blockchain);
        if (options.search) {
          const needle = options.search.toLowerCase();
          tokens = tokens.filter(
            (t) =>
              (t.symbol ?? "").toLowerCase().includes(needle) ||
              (t.name ?? "").toLowerCase().includes(needle),
          );
        }
        if (options.popular) tokens = tokens.filter((t) => t.isPopular);
        if (isJsonMode()) return printJson(tokens);
        const limit = options.limit ? Number(options.limit) : TABLE_LIMIT;
        const shown = tokens.slice(0, limit);
        print(
          recordsTable(shown.map(tokenRow), ["symbol", "name", "address", "decimals", "usdPrice", "popular"]),
        );
        const more = tokens.length - shown.length;
        print(
          `\n${tokens.length} tokens on ${blockchain}${more > 0 ? ` (${more} more; use --limit or --json)` : ""}`,
        );
      }),
    );

  program
    .command("token <chain> <symbolOrAddress>")
    .description("One token by symbol or address, including decimals")
    .addHelpText(
      "after",
      "\nExamples:\n  $ rango token ETH USDC\n  $ rango token BSC 0x55d398326f99059ff775485246999027b3197955",
    )
    .action(
      action(async (chain: string, symbolOrAddress: string) => {
        const blockchain = chain.toUpperCase();
        // Symbols are short; anything 0x-prefixed or longer than a symbol is an address.
        const isAddress = /^0x[0-9a-f]+$/i.test(symbolOrAddress) || symbolOrAddress.length > 12;
        const asset = parseAsset(
          isAddress ? `${blockchain}--${symbolOrAddress}` : `${blockchain}.${symbolOrAddress}`,
        );
        let token = findToken(await fetchTokens(blockchain), asset);
        if (!token && asset.address) {
          const custom = await api.get<CustomTokenResponse>("/basic/meta/custom-token", {
            params: { blockchain, address: asset.address },
          });
          token = custom.token ?? undefined;
        }
        if (!token) {
          throw invalidArgs(
            `Token "${symbolOrAddress}" not found on ${blockchain}`,
            `Try: rango tokens ${blockchain} --search ${symbolOrAddress}`,
          );
        }
        if (isJsonMode()) return printJson(token);
        print(
          keyValue([
            ["Symbol", token.symbol],
            ["Name", token.name],
            ["Blockchain", token.blockchain],
            ["Address", token.address ?? "(native)"],
            ["Decimals", token.decimals],
            ["USD price", token.usdPrice],
            ["Popular", token.isPopular],
            [
              "Asset",
              token.address
                ? `${token.blockchain}.${token.symbol}--${token.address}`
                : `${token.blockchain}.${token.symbol}`,
            ],
          ]),
        );
      }),
    );
}
