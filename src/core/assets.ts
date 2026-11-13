import type { MetaResponse, Token } from "../types/index.js";
import { invalidArgs } from "./errors.js";
import { toSmallestUnit } from "./format.js";
import { api } from "./http.js";

/**
 * Rango asset notation:
 *   BSC.BNB                       native coin
 *   BSC                           native coin, symbol omitted
 *   BSC--0x55d3…                  token by address
 *   BSC.USDT--0x55d3…             token by symbol and address
 */
export interface ParsedAsset {
  blockchain: string;
  symbol: string | undefined;
  address: string | undefined;
}

export function parseAsset(asset: string): ParsedAsset {
  const text = asset.trim();
  const [head = "", address] = text.split("--");
  const [blockchain = "", symbol] = head.split(".");
  if (!blockchain) {
    throw invalidArgs(
      `Invalid asset "${asset}"`,
      'Expected BLOCKCHAIN.SYMBOL or BLOCKCHAIN.SYMBOL--ADDRESS, e.g. "BSC.BNB".',
    );
  }
  return {
    blockchain: blockchain.toUpperCase(),
    symbol: symbol ? symbol.toUpperCase() : undefined,
    address: address || undefined,
  };
}

export function isIntegerAmount(amount: string): boolean {
  return /^\d+$/.test(amount.trim());
}

export async function fetchTokens(blockchain: string): Promise<Token[]> {
  const meta = await api.get<MetaResponse>("/basic/meta", { params: { blockchains: blockchain } });
  return meta.tokens ?? [];
}

export function findToken(tokens: Token[], asset: ParsedAsset): Token | undefined {
  if (asset.address) {
    const wanted = asset.address.toLowerCase();
    return tokens.find((t) => (t.address ?? "").toLowerCase() === wanted);
  }
  const bySymbol = tokens.filter(
    (t) => (t.symbol ?? "").toUpperCase() === asset.symbol && t.blockchain === asset.blockchain,
  );
  return bySymbol.find((t) => t.address === null || t.address === undefined) ?? bySymbol[0];
}

/**
 * Accept either the smallest unit (an integer) or a human decimal ("1.5").
 * A decimal needs the token's decimals, looked up from /basic/meta.
 */
export async function resolveAmount(amount: string, asset: string): Promise<string> {
  const text = amount.trim();
  if (isIntegerAmount(text)) return text;
  if (!/^\d*\.\d+$/.test(text) && !/^\d+\.$/.test(text)) {
    throw invalidArgs(
      `Invalid amount "${amount}"`,
      "Use the smallest unit as an integer (1000000) or a decimal (1.5).",
    );
  }
  const parsed = parseAsset(asset);
  if (!parsed.symbol && !parsed.address) {
    throw invalidArgs(
      `Cannot resolve decimals for "${asset}"`,
      "Name the token (BSC.BNB) or pass the amount in its smallest unit.",
    );
  }
  const token = findToken(await fetchTokens(parsed.blockchain), parsed);
  if (!token || typeof token.decimals !== "number") {
    throw invalidArgs(
      `Token ${asset} not found in Rango's list, so "${amount}" cannot be converted`,
      "Pass the amount in the token's smallest unit instead, or check the asset with: rango token <chain> <symbol>",
    );
  }
  try {
    return toSmallestUnit(text, token.decimals);
  } catch (error) {
    throw invalidArgs((error as Error).message);
  }
}
