import type { Command } from "commander";
import { action } from "../core/command.js";
import { recordsTable } from "../core/format.js";
import { api } from "../core/http.js";
import { isJsonMode, print, printJson } from "../core/output.js";
import type { Swapper } from "../types/index.js";

export function registerSwappersCommand(program: Command): void {
  program
    .command("swappers")
    .description("Every DEX, bridge and aggregator Rango routes through")
    .option("--type <type>", "Only this type: DEX, BRIDGE, AGGREGATOR, OFF_CHAIN")
    .option("--all", "Include disabled swappers")
    .addHelpText(
      "after",
      "\nExamples:\n  $ rango swappers --type BRIDGE\n  $ rango swappers --json | jq '.[].id'",
    )
    .action(
      action(async (options: { type?: string; all?: boolean }) => {
        const data = await api.get<Swapper[]>("/basic/meta/swappers");
        let swappers = Array.isArray(data) ? data : [];
        if (options.type) {
          const wanted = options.type.toUpperCase();
          swappers = swappers.filter((s) => (s.types ?? []).some((t) => t.toUpperCase() === wanted));
        }
        if (!options.all) swappers = swappers.filter((s) => s.enabled !== false);
        if (isJsonMode()) return printJson(swappers);
        print(
          recordsTable(
            swappers.map((s) => ({
              id: s.id,
              title: s.title,
              types: (s.types ?? []).join(","),
              group: s.swapperGroup,
              enabled: s.enabled,
            })),
            ["id", "title", "types", "group", "enabled"],
          ),
        );
        print(`\n${swappers.length} swappers. Pass ids to --swappers on quote and swap.`);
      }),
    );
}
