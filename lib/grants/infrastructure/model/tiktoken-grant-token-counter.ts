import { getEncoding } from "js-tiktoken";
import type { GrantTokenCounter } from "../../ports/grant-token-counter.ts";

const encoding = getEncoding("o200k_base");

export class TiktokenGrantTokenCounter implements GrantTokenCounter {
  readonly tokenizerId = "o200k_base";
  count(text: string): number {
    return encoding.encode(text).length;
  }
}

