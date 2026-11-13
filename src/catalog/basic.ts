import { z } from "zod";
import type { Params } from "../core/http.js";
import { eventType, flag, list, metaFilters, metaParams, optNum, optStr, str, tags } from "./shared.js";
import { compact, defineOperation } from "./types.js";

/**
 * Basic API: single-step swaps. One quote, one swap, one status call.
 * Assets use the BLOCKCHAIN.SYMBOL--ADDRESS notation; amounts are the
 * token's smallest unit as an integer string.
 */

const assetFrom = str('Source asset, e.g. "BSC.BNB" or "ETH.USDC--0xa0b8…"');
const assetTo = str("Destination asset, same notation");
const amount = str("Amount in the token's smallest unit, as an integer string (1 ETH = 1000000000000000000)");

const routingFilters = {
  swappers: list("Only route through these swapper ids"),
  swappersExclude: flag("Treat swappers as a deny list"),
  swapperGroups: list("Only these swapper group tags"),
  swappersGroupsExclude: flag("Treat swapperGroups as a deny list"),
  messagingProtocols: list("Messaging protocols for before/after-swap calls"),
  imMessage: optStr("Message to call after or before the swap"),
  sourceContract: optStr("Contract called before the swap"),
  destinationContract: optStr("Contract called after the swap"),
  contractCall: flag("Transactions are sent through a contract"),
  referrerCode: optStr("Referrer code for fee sharing"),
  referrerFee: optNum("Referrer fee in percent, 0 to 10"),
  avoidNativeFee: flag("Skip swappers that charge fees in the native token (account-abstraction wallets)"),
  enableCentralizedSwappers: flag("Include centralized swappers"),
  depositTransaction: flag("Only routes done with a single plain transfer to a deposit address"),
};

function joinLists(input: Record<string, unknown>): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(",") : (v as string | number | boolean);
  }
  return out;
}

export const basicOperations = [
  defineOperation({
    surface: "basic",
    name: "meta",
    summary: "All tokens, blockchains and swappers in one call",
    description:
      "Several megabytes without a filter. Always pass blockchains to narrow it. Returns {blockchains, tokens, swappers}.",
    readOnly: true,
    input: z.object(metaFilters),
    request: (input) => ({ method: "GET", path: "/basic/meta", params: metaParams(input) }),
  }),
  defineOperation({
    surface: "basic",
    name: "chains",
    summary: "Every supported blockchain",
    description:
      "Names here are the BLOCKCHAIN part of asset notation. Includes address patterns and fee assets.",
    readOnly: true,
    input: z.object({}),
    request: () => ({ method: "GET", path: "/basic/meta/blockchains" }),
  }),
  defineOperation({
    surface: "basic",
    name: "swappers",
    summary: "Every DEX, bridge and aggregator",
    description: "Ids here are what the swappers filter on quote and swap accepts.",
    readOnly: true,
    input: z.object({}),
    request: () => ({ method: "GET", path: "/basic/meta/swappers" }),
  }),
  defineOperation({
    surface: "basic",
    name: "messaging-protocols",
    summary: "Cross-chain messaging protocols",
    description: "Protocols usable for contract calls alongside a swap.",
    readOnly: true,
    input: z.object({}),
    request: () => ({ method: "GET", path: "/basic/meta/messaging-protocols" }),
  }),
  defineOperation({
    surface: "basic",
    name: "custom-token",
    summary: "Details of a token not in Rango's list",
    description: "EVM and Solana only. Returns {token, error, errorCode, traceId}.",
    readOnly: true,
    input: z.object({ blockchain: str("Blockchain name, e.g. ETH"), address: str("Token contract address") }),
    request: (input) => ({ method: "GET", path: "/basic/meta/custom-token", params: input }),
  }),
  defineOperation({
    surface: "basic",
    name: "quote",
    summary: "Best single-step route, without a transaction",
    description:
      "Check resultType first: OK, HIGH_IMPACT, NO_ROUTE or INPUT_LIMIT_ISSUE. route holds outputAmount, outputAmountMin, fee, feeUsd, estimatedTimeInSeconds and path.",
    readOnly: true,
    input: z.object({
      from: assetFrom,
      to: assetTo,
      amount,
      slippage: optNum("Slippage in percent, 0.01 to 30 (default 0.5)"),
      ...routingFilters,
    }),
    request: (input) => ({ method: "GET", path: "/basic/quote", params: joinLists(input) }),
  }),
  defineOperation({
    surface: "basic",
    name: "swap",
    summary: "Build the unsigned transaction for a swap",
    description:
      "Returns tx for the wallet to sign; nothing is signed or sent here. If tx carries approveTo/approveData, sign that first, wait for is-approved, then call again. Show the user toAddress, amount and outputAmountMin before they sign.",
    readOnly: false,
    input: z.object({
      from: assetFrom,
      to: assetTo,
      amount,
      slippage: z.number().describe("Slippage in percent, 0.01 to 30"),
      fromAddress: str("Wallet that signs and pays"),
      toAddress: str("Wallet that receives the output"),
      disableEstimate: flag("Skip balance and fee checks; only for previews"),
      infiniteApprove: flag("Ask for an unlimited token allowance"),
      referrerAddress: optStr("Wallet that receives the referrer fee"),
      useMaxNativeTokenBalance: flag("Subtract fees from the input when the balance is short"),
      ...routingFilters,
    }),
    request: (input) => ({ method: "GET", path: "/basic/swap", params: joinLists(input) }),
  }),
  defineOperation({
    surface: "basic",
    name: "status",
    summary: "Status of a swap from its requestId and signed tx hash",
    description:
      "status is running, success or failed. output says what arrived, including a substitute token when a bridge had to fall back. Poll every 10 to 30 seconds.",
    readOnly: true,
    input: z.object({
      requestId: str("requestId from quote or swap"),
      txId: str("Hash of the signed main transaction"),
    }),
    request: (input) => ({ method: "GET", path: "/basic/status", params: input }),
  }),
  defineOperation({
    surface: "basic",
    name: "is-approved",
    summary: "Whether an approval transaction has confirmed",
    description: "Returns isApproved, txStatus, requiredApprovedAmount and currentApprovedAmount.",
    readOnly: true,
    input: z.object({ requestId: str("requestId from swap"), txId: str("Hash of the approval transaction") }),
    request: (input) => ({ method: "GET", path: "/basic/is-approved", params: input }),
  }),
  defineOperation({
    surface: "basic",
    name: "report-tx",
    summary: "Report a wallet rejection or send failure",
    description: "Optional, helps routing quality. Not for inbound transactions.",
    readOnly: false,
    input: z.object({
      requestId: str("requestId of the swap"),
      eventType,
      reason: optStr("Free-text reason"),
      tags,
    }),
    request: (input) => ({
      method: "POST",
      path: "/basic/report-tx",
      body: compact({ ...input, reason: input.reason ?? input.eventType }),
    }),
  }),
  defineOperation({
    surface: "basic",
    name: "balance",
    summary: "All token balances of a wallet on one blockchain",
    description: "Slow endpoint. Amounts come back in smallest units with decimals.",
    readOnly: true,
    input: z.object({ blockchain: str("Blockchain name, e.g. ETH"), address: str("Wallet address") }),
    request: (input) => ({ method: "GET", path: "/basic/balance", params: input }),
  }),
  defineOperation({
    surface: "basic",
    name: "token-balance",
    summary: "One token's balance for a wallet",
    description: "Faster than balance. Omit address for the native coin.",
    readOnly: true,
    input: z.object({
      blockchain: str("Blockchain name"),
      symbol: str("Token symbol"),
      address: optStr("Token contract address; omit for the native coin"),
      walletAddress: str("Wallet address"),
    }),
    request: (input) => ({ method: "GET", path: "/basic/token-balance", params: compact(input) }),
  }),
  defineOperation({
    surface: "basic",
    name: "connected-assets",
    summary: "Assets reachable from one asset in a single step",
    description: "An empty asset list for a blockchain means every asset on it is reachable.",
    readOnly: true,
    input: z.object({ from: str('Source asset, e.g. "ETH.ETH"') }),
    request: (input) => ({ method: "GET", path: "/basic/connected-assets", params: input }),
  }),
];
