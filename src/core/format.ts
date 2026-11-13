/** Rendering helpers with no dependency: amounts, durations, tables. */

/** Smallest-unit string to a human decimal, without floating point. */
export function formatAmount(
  raw: string | number | null | undefined,
  decimals: number | null | undefined,
): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const digits = String(raw).trim();
  if (!/^\d+$/.test(digits)) return digits; // already decimal or not numeric
  const d = decimals ?? 0;
  if (d === 0) return digits;
  const padded = digits.padStart(d + 1, "0");
  const intPart = padded.slice(0, padded.length - d);
  const fracPart = padded.slice(padded.length - d).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/** Human decimal string to smallest-unit integer string. Throws on too many decimals. */
export function toSmallestUnit(human: string, decimals: number): string {
  const text = human.trim();
  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") {
    throw new Error(`Not a decimal amount: ${human}`);
  }
  const [intPart = "", fracPart = ""] = text.split(".");
  if (fracPart.length > decimals) {
    throw new Error(`${human} has ${fracPart.length} decimal places but the token has ${decimals}`);
  }
  const combined = `${intPart}${fracPart.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  return combined === "" ? "0" : combined;
}

export function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number") return "";
  if (seconds >= 3600) return `~${Math.round(seconds / 3600)} h`;
  if (seconds >= 60) return `~${Math.round(seconds / 60)} min`;
  return `~${Math.round(seconds)} s`;
}

/** Shorten to `max` characters; a non-positive `max` means no limit. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return text;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function cell(value: unknown, max = 48): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return truncate(JSON.stringify(value), max);
  return truncate(String(value).replace(/\n/g, " "), max);
}

export function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "(no rows)";
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), rule, ...rows.map(line)].join("\n");
}

export function keyValue(rows: [string, unknown][]): string {
  const kept = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");
  const width = Math.max(0, ...kept.map(([k]) => k.length));
  return kept.map(([k, v]) => `${k.padEnd(width)}  ${cell(v, 0) || String(v)}`).join("\n");
}

export function recordsTable(records: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Array.from(new Set(records.flatMap((r) => Object.keys(r))));
  return table(
    cols,
    records.map((r) => cols.map((c) => cell(r[c]))),
  );
}
