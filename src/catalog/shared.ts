import { z } from "zod";

/** Small zod helpers so the catalogue reads as a table, not a wall of schema. */
export const str = (desc: string) => z.string().describe(desc);
export const optStr = (desc: string) => z.string().optional().describe(desc);
export const num = (desc: string) => z.number().describe(desc);
export const optNum = (desc: string) => z.number().optional().describe(desc);
export const int = (desc: string) => z.number().int().describe(desc);
export const flag = (desc: string) => z.boolean().optional().describe(desc);
export const list = (desc: string) => z.array(z.string()).optional().describe(desc);
export const record = (desc: string) => z.record(z.string(), z.string()).optional().describe(desc);

export const REPORT_EVENTS = [
  "FETCH_TX_FAILED",
  "USER_REJECT",
  "USER_CANCEL",
  "CALL_WALLET_FAILED",
  "SEND_TX_FAILED",
  "CLIENT_UNEXPECTED_BEHAVIOUR",
  "TX_EXPIRED",
  "INSUFFICIENT_APPROVE",
  "USER_CANCELED_TX",
  "CALL_OR_SEND_FAILED",
  "TX_FAILED_IN_BLOCKCHAIN",
  "WRONG_TX_HASH",
] as const;

export const eventType = z.enum(REPORT_EVENTS).describe("What happened on the client side");

/** Filters shared by the metadata endpoints on both surfaces. */
export const metaFilters = {
  blockchains: list('Only these blockchains, e.g. ["ETH","BSC"]'),
  blockchainsExclude: flag("Treat blockchains as a deny list"),
  swappers: list("Only these swapper ids"),
  swappersExclude: flag("Treat swappers as a deny list"),
  swapperGroups: list("Only these swapper group tags"),
  swappersGroupsExclude: flag("Treat swapperGroups as a deny list"),
  transactionTypes: list('Only these transaction types, e.g. ["EVM","COSMOS","SOLANA"]'),
  transactionTypesExclude: flag("Treat transactionTypes as a deny list"),
  excludeSecondaries: flag("Drop secondary tokens"),
  excludeNonPopulars: flag("Only popular tokens"),
  enableCentralizedSwappers: flag("Include centralized swappers"),
};

/** Query-string form of the metadata filters: lists become comma-separated. */
export function metaParams(input: Record<string, unknown>): Record<string, string | boolean | undefined> {
  const out: Record<string, string | boolean | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(",") : (value as string | boolean);
  }
  return out;
}

export const tags = z
  .record(z.string(), z.string())
  .optional()
  .describe('Extra context, e.g. {"wallet":"metamask","errorCode":"4001"}');
