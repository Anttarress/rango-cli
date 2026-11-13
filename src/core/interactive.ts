import { createInterface } from "node:readline/promises";
import { invalidArgs } from "./errors.js";
import { isInteractive } from "./output.js";

/** Ask for a missing value on a terminal; refuse when input is disabled or piped. */
export async function promptIfMissing(value: string | undefined, label: string): Promise<string> {
  if (value) return value;
  if (!isInteractive()) {
    throw invalidArgs(
      `Missing required option: ${label}`,
      "Pass every required flag when not on a terminal or with --no-input.",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${label}: `)).trim();
    if (!answer) throw invalidArgs(`Missing required option: ${label}`);
    return answer;
  } finally {
    rl.close();
  }
}

export async function confirm(question: string): Promise<boolean> {
  if (!isInteractive()) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
