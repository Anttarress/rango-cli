import { type Command, Option } from "commander";
import { action } from "../core/command.js";
import { REPORT_EVENT_TYPES } from "../core/constants.js";
import { api } from "../core/http.js";
import { isJsonMode, print, printJson } from "../core/output.js";

export function registerReportCommand(program: Command): void {
  program
    .command("report <requestId>")
    .description("Report a swap the wallet rejected or failed to send, so Rango can improve routing")
    .addOption(
      new Option("--event <type>", "What happened").choices([...REPORT_EVENT_TYPES]).makeOptionMandatory(),
    )
    .option("--reason <text>", "Free-text reason")
    .option("--wallet <name>", "Wallet in use, kept as a tag")
    .option("--error-code <code>", "Wallet or RPC error code, kept as a tag")
    .addHelpText(
      "after",
      '\nExamples:\n  $ rango report 50365411-… --event USER_REJECT --reason "declined in MetaMask"',
    )
    .action(
      action(
        async (
          requestId: string,
          options: { event: string; reason?: string; wallet?: string; errorCode?: string },
        ) => {
          const tags: Record<string, string> = {};
          if (options.wallet) tags["wallet"] = options.wallet;
          if (options.errorCode) tags["errorCode"] = options.errorCode;
          const body = {
            requestId,
            eventType: options.event,
            reason: options.reason ?? options.event,
            ...(Object.keys(tags).length ? { tags } : {}),
          };
          const data = await api.post<unknown>("/basic/report-tx", { body });
          if (isJsonMode()) return printJson(data ?? { ok: true });
          print(`Reported ${options.event} for ${requestId}.`);
        },
      ),
    );
}
