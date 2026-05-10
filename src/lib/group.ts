// Group / multiplayer bracket coordination.
//
// We're a static SPA with no backend, so we coordinate multiple users via
// a URL-passing chain. Each contributor adds their slice of the pool and
// forwards a longer URL to the next person. The last person in the chain
// ranks the merged pool.
//
// URL shape:  /pool/?g=<N>&s=<K>&t=<TOTAL>&p=<comma-sep IDs from earlier slots>
//   g — group size (2..4)
//   s — current slot (1..g). User opening the link is contributing slot s.
//   t — total pool size (64 | 128). Optional; defaults to 128 for old links.
//   p — IDs already contributed by slots 1..s-1. Empty for s=1.

import type { PoolSize } from "./storage";

export const MIN_GROUP = 2;
export const MAX_GROUP = 4;
const DEFAULT_TOTAL: PoolSize = 128;

export type GroupParams = {
  groupSize: number;
  slotIndex: number;
  totalSize: PoolSize;
  fromIds: string[];
};

export function parseGroupParams(search: URLSearchParams): GroupParams | null {
  const g = parseInt(search.get("g") ?? "", 10);
  const s = parseInt(search.get("s") ?? "", 10);
  if (!g || !s) return null;
  if (g < MIN_GROUP || g > MAX_GROUP) return null;
  if (s < 1 || s > g) return null;
  const tRaw = parseInt(search.get("t") ?? "", 10);
  const totalSize: PoolSize = tRaw === 64 || tRaw === 128 ? (tRaw as PoolSize) : DEFAULT_TOTAL;
  const p = search.get("p") ?? "";
  const fromIds = p
    ? p.split(",").map((x) => x.trim()).filter(Boolean)
    : [];
  return { groupSize: g, slotIndex: s, totalSize, fromIds };
}

/** How many tracks the user in slot K is supposed to contribute.
 *  Distributes `total` evenly; remainder goes to the LAST slot so middle
 *  slots don't have to think about uneven sizes. */
export function slotSize(groupSize: number, slotIndex: number, total: number = DEFAULT_TOTAL): number {
  const base = Math.floor(total / groupSize);
  return slotIndex === groupSize ? total - base * (groupSize - 1) : base;
}

/** Total tracks expected to have arrived from earlier slots. */
export function expectedFromCount(groupSize: number, slotIndex: number, total: number = DEFAULT_TOTAL): number {
  let sum = 0;
  for (let i = 1; i < slotIndex; i++) sum += slotSize(groupSize, i, total);
  return sum;
}

export function buildHandoffUrl(opts: {
  origin: string;
  basePath: string;
  groupSize: number;
  nextSlot: number;
  totalSize: PoolSize;
  combinedIds: string[];
}): string {
  return (
    `${opts.origin}${opts.basePath}/pool/` +
    `?g=${opts.groupSize}` +
    `&s=${opts.nextSlot}` +
    `&t=${opts.totalSize}` +
    `&p=${opts.combinedIds.join(",")}`
  );
}
