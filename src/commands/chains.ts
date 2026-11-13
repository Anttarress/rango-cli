import type { Command } from "commander";
import { action } from "../core/command.js";
import { invalidArgs } from "../core/errors.js";
import { keyValue, recordsTable } from "../core/format.js";
import { api } from "../core/http.js";
import { isJsonMode, print, printJson } from "../core/output.js";
import type { Blockchain } from "../types/index.js";

export async function fetchChains(): Promise<Blockchain[]> {
  const data = await api.get<Blockchain[]>("/basic/meta/blockchains");
  return Array.isArray(data) ? data : [];
}

export function findChain(chains: Blockchain[], name: string): Blockchain | undefined {
  const wanted = name.trim().toLowerCase();
  return (
    chains.find((c) => c.name.toLowerCase() === wanted) ??
    chains.find(
      (c) => (c.displayName ?? "").toLowerCase() === wanted || (c.shortName ?? "").toLowerCase() === wanted,
    ) ??
    chains.find((c) => (c.chainId ?? "").toLowerCase() === wanted)
  );
}

export function registerChainsCommand(program: Command): void {
  program
    .command("chains")
    .description("List every blockchain Rango supports")
    .option("--type <type>", "Only this chain type: EVM, COSMOS, SOLANA, TRANSFER, STARKNET, TRON, TON, SUI")
    .option("--all", "Include disabled chains")
    .addHelpText(
      "after",
      `
Examples:
  $ rango chains
  $ rango chains --type EVM
  $ rango chains --json | jq '.[].name'`,
    )
    .action(
      action(async (options: { type?: string; all?: boolean }) => {
        let chains = await fetchChains();
        if (options.type) {
          const wanted = options.type.toUpperCase();
          chains = chains.filter((c) => (c.type ?? "").toUpperCase() === wanted);
        }
        if (!options.all) chains = chains.filter((c) => c.enabled !== false);
        if (isJsonMode()) return printJson(chains);
        print(
          recordsTable(
            chains.map((c) => ({
              name: c.name,
              displayName: c.displayName,
              type: c.type,
              chainId: c.chainId,
              enabled: c.enabled,
            })),
            ["name", "displayName", "type", "chainId", "enabled"],
          ),
        );
        print(
          `\n${chains.length} chains. Use the "name" column in asset notation, e.g. ${chains[0]?.name ?? "BSC"}.BNB`,
        );
      }),
    );

  program
    .command("chain <name>")
    .description("Details of one blockchain: address patterns, fee assets, explorer")
    .addHelpText("after", '\nExamples:\n  $ rango chain ARBITRUM\n  $ rango chain "BNB Chain"')
    .action(
      action(async (name: string) => {
        const chains = await fetchChains();
        const chain = findChain(chains, name);
        if (!chain) {
          throw invalidArgs(
            `Unknown blockchain "${name}"`,
            `Run: rango chains  (known: ${chains.map((c) => c.name).join(", ")})`,
          );
        }
        if (isJsonMode()) return printJson(chain);
        print(
          keyValue([
            ["Name", chain.name],
            ["Display name", chain.displayName],
            ["Type", chain.type],
            ["Chain id", chain.chainId],
            ["Enabled", chain.enabled],
            ["Decimals", chain.defaultDecimals],
            ["Fee assets", (chain.feeAssets ?? []).map((f) => f.symbol).join(", ")],
            ["Address patterns", (chain.addressPatterns ?? []).join("  ")],
            ["Explorer", chain.info?.blockExplorerUrls?.[0]],
          ]),
        );
      }),
    );
}
