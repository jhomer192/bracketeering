// Group / multiplayer bracket coordination.
//
// We're a static SPA with no backend, so we coordinate multiple users via
// a URL-passing chain. Each contributor adds their slice of the pool and
// forwards a longer URL to the next person. The last person in the chain
// ranks the merged 128.
//
// URL shape:  /pool/?g=<N>&s=<K>&p=<comma-sep IDs from earlier slots>
//   g — group size (2..4)
//   s — current slot (1..g). User opening the link is contributing slot s.
//   p — IDs already contributed by slots 1..s-1. Empty for s=1.

const TOTAL = 128;
export const MIN_GROUP = 2;
export const MAX_GROUP = 4;

export type GroupParams = {
  groupSize: number;
  slotIndex: number;
  fromIds: string[];
};

export function parseGroupParams(search: URLSearchParams): GroupParams | null {
  const g = parseInt(search.get("g") ?? "", 10);
  const s = parseInt(search.get("s") ?? "", 10);
  if (!g || !s) return null;
  if (g < MIN_GROUP || g > MAX_GROUP) return null;
  if (s < 1 || s > g) return null;
  const p = search.get("p") ?? "";
  const fromIds = p
    ? p.split(",").map((x) => x.trim()).filter(Boolean)
    : [];
  return { groupSize: g, slotIndex: s, fromIds };
}

/** How many tracks the user in slot K is supposed to contribute.
 *  Distributes 128 evenly; remainder goes to the LAST slot so middle slots
 *  don't have to think about uneven sizes. */
export function slotSize(groupSize: number, slotIndex: number): number {
  const base = Math.floor(TOTAL / groupSize);
  return slotIndex === groupSize ? TOTAL - base * (groupSize - 1) : base;
}

/** Total tracks expected to have arrived from earlier slots. */
export function expectedFromCount(groupSize: number, slotIndex: number): number {
  let sum = 0;
  for (let i = 1; i < slotIndex; i++) sum += slotSize(groupSize, i);
  return sum;
}

export function buildHandoffUrl(opts: {
  origin: string;
  basePath: string;
  groupSize: number;
  nextSlot: number;
  combinedIds: string[];
}): string {
  return (
    `${opts.origin}${opts.basePath}/pool/` +
    `?g=${opts.groupSize}` +
    `&s=${opts.nextSlot}` +
    `&p=${opts.combinedIds.join(",")}`
  );
}
