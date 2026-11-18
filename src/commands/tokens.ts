import type { Command } from "commander";
import { fetchTokens, findToken, parseAsset } from "../core/assets.js";
import { action } from "../core/command.js";
import { invalidArgs } from "../core/errors.js";
import { keyValue, recordsTable } from "../core/format.js";
import { api } from "../core/http.js";
import { isJsonMode, print, printJson } from "../core/output.js";
import type { CustomTokenResponse, Token } from "../types/index.js";

type Surface = "basic" | "main";

const customTokenPath = (surface: Surface) =>
  surface === "main" ? "/meta/custom-token" : "/basic/meta/custom-token";

function registerTokensSubcommand(group: Command, surface: Surface): void {
  group
    .command("tokens <chain>")
    .description("Tokens Rango knows on one blockchain")
    .option("--search <text>", "Only tokens whose symbol or name contains this text")
    .option("--popular", "Only tokens Rango marks as popular")
    .addHelpText(
      "after",
      `\nExamples:\n  $ rango ${surface} tokens ETH --search usdc\n  $ rango ${surface} tokens BSC --popular --json`,
    )
    .action(
      action(async (chain: string, options: { search?: string; popular?: boolean }) => {
        const blockchain = chain.toUpperCase();
        let tokens = await fetchTokens(blockchain, surface);
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
        print(
          recordsTable(
            tokens.map((t: Token) => ({
              symbol: t.symbol,
              name: t.name,
              address: t.address ?? "(native)",
              decimals: t.decimals,
              usdPrice: t.usdPrice,
              popular: t.isPopular,
            })),
            ["symbol", "name", "address", "decimals", "usdPrice", "popular"],
          ),
        );
        print(`\n${tokens.length} tokens on ${blockchain}`);
      }),
    );
}

function registerTokenSubcommand(group: Command, surface: Surface): void {
  group
    .command("token <chain> <symbolOrAddress>")
    .description("One token by symbol or address, with a custom-token fallback")
    .addHelpText(
      "after",
      `\nExamples:\n  $ rango ${surface} token ETH USDC\n  $ rango ${surface} token BSC 0x55d398326f99059ff775485246999027b3197955`,
    )
    .action(
      action(async (chain: string, symbolOrAddress: string) => {
        const blockchain = chain.toUpperCase();
        // Symbols are short; anything 0x-prefixed or longer than a symbol is an address.
        const isAddress = /^0x[0-9a-f]+$/i.test(symbolOrAddress) || symbolOrAddress.length > 12;
        const asset = parseAsset(
          isAddress ? `${blockchain}--${symbolOrAddress}` : `${blockchain}.${symbolOrAddress}`,
        );
        let token = findToken(await fetchTokens(blockchain, surface), asset);
        if (!token && asset.address) {
          const custom = await api.get<CustomTokenResponse>(customTokenPath(surface), {
            params: { blockchain, address: asset.address },
          });
          token = custom.token ?? undefined;
        }
        if (!token) {
          throw invalidArgs(
            `Token "${symbolOrAddress}" not found on ${blockchain}`,
            `Try: rango ${surface} meta --blockchains ${blockchain}`,
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

export function registerSurfaceTokenCommands(group: Command, surface: Surface): void {
  registerTokensSubcommand(group, surface);
  registerTokenSubcommand(group, surface);
}
