import type { Command } from "commander";
import { action, parseNumber } from "../core/command.js";
import { ExitCode, TERMINAL_STATUSES } from "../core/constants.js";
import { CliError } from "../core/errors.js";
import { formatAmount, keyValue } from "../core/format.js";
import { api } from "../core/http.js";
import { color, isJsonMode, note, print, printJson } from "../core/output.js";
import type { ApprovalResponse, StatusResponse } from "../types/index.js";
import { assetLabel } from "./quote.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function renderStatus(data: StatusResponse): string {
  const status = (data.status ?? "pending").toLowerCase();
  const painted =
    status === "success"
      ? color.green(status)
      : status === "failed"
        ? color.red(status)
        : color.yellow(status);
  const out = data.output;
  const rows: [string, unknown][] = [
    ["Status", painted],
    ["Error", data.error],
    [
      "Output",
      out
        ? `${formatAmount(out.amount, out.receivedToken?.decimals)} ${assetLabel(out.receivedToken)}${out.type ? ` [${out.type}]` : ""}`
        : undefined,
    ],
    ["Diagnosis", data.diagnosisUrl],
  ];
  for (const link of data.explorerUrl ?? []) {
    if (link?.url) rows.push([`Explorer${link.description ? ` (${link.description})` : ""}`, link.url]);
  }
  return keyValue(rows);
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status <requestId> <txHash>")
    .description("Status of a swap from its requestId and the signed transaction hash")
    .option("--watch", "Poll until the swap succeeds or fails")
    .option("--interval <seconds>", "Seconds between polls", "10")
    .option("--timeout <seconds>", "Give up after this many seconds", "1800")
    .addHelpText(
      "after",
      `
Examples:
  $ rango status 50365411-295c-4431-8ade-d848f84c46f2 0xabc…
  $ rango status 50365411-… 0xabc… --watch --interval 15`,
    )
    .action(
      action(
        async (
          requestId: string,
          txHash: string,
          options: { watch?: boolean; interval?: string; timeout?: string },
        ) => {
          const params = { requestId, txId: txHash };
          const fetchStatus = () => api.get<StatusResponse>("/basic/status", { params });
          if (!options.watch) {
            const data = await fetchStatus();
            return isJsonMode() ? printJson(data) : print(renderStatus(data));
          }
          const interval = Math.max(1, parseNumber("--interval", options.interval) ?? 10);
          const timeout = parseNumber("--timeout", options.timeout) ?? 1800;
          const started = Date.now();
          let last: StatusResponse = {};
          for (;;) {
            last = await fetchStatus();
            const status = (last.status ?? "").toLowerCase();
            if (TERMINAL_STATUSES.has(status)) break;
            if ((Date.now() - started) / 1000 >= timeout) {
              throw new CliError(
                `Still ${status || "pending"} after ${timeout}s`,
                ExitCode.General,
                `Keep watching with: rango status ${requestId} ${txHash} --watch`,
                last,
              );
            }
            note(`status: ${status || "pending"}; next check in ${interval}s`);
            await sleep(interval * 1000);
          }
          if (isJsonMode()) printJson(last);
          else print(renderStatus(last));
          if ((last.status ?? "").toLowerCase() === "failed") process.exitCode = ExitCode.ApiError;
        },
      ),
    );

  program
    .command("approval <requestId> <txHash>")
    .description("Whether an approval transaction has confirmed and covers the swap amount")
    .action(
      action(async (requestId: string, txHash: string) => {
        const data = await api.get<ApprovalResponse>("/basic/is-approved", {
          params: { requestId, txId: txHash },
        });
        if (!data.isApproved) process.exitCode = ExitCode.General;
        if (isJsonMode()) return printJson(data);
        print(
          keyValue([
            ["Approved", data.isApproved],
            ["Tx status", data.txStatus],
            ["Required", data.requiredApprovedAmount],
            ["Current", data.currentApprovedAmount],
          ]),
        );
      }),
    );
}
