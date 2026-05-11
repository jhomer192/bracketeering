// Single-image tournament bracket export for the reveal page.
//
// Renders the user's top 16 (or top 8 if pool is shallower) as a classic
// single-elimination bracket — standard seeded matchups (1v16, 8v9, ...)
// where the higher-ranked seed always advances. The visual point of the
// PNG is "this is what my bracket looked like": shareable, glanceable,
// and obviously a Songrank artifact.
//
// Layout: 1080×1920 portrait (Instagram/Snap Stories aspect), same canvas
// pattern + crossOrigin album art loading as cardExport.ts. Different
// renderer entirely though — this draws an actual tree, not a list/mosaic.
//
// Why seeded bracket (not the actual vote history): the comparison engine
// is binary insertion sort, not single-elim, so there is no "real" bracket
// tree to render. We use the final ranking as the seeding — which is what
// the user actually cares about anyway ("here's my top 16, in order").

import type { PoolEntry } from "./pool";

const W = 1080;
const H = 1920;
const PAD = 48;
const FOOTER_H = 110;

export type BracketSize = 16 | 8;

/** Standard single-elimination seeding for a bracket of `size` slots.
 *  Returns matchup pairs as 1-indexed seeds for the round of `size`,
 *  laid out top-to-bottom so the bracket reads like an NCAA bracket
 *  (1 at the top, 2 at the bottom, others bridging in the standard
 *  "snake" pattern that puts likely-best opponents on opposite sides).
 *
 *  For size=16: [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]]
 *  For size=8:  [[1,8],[4,5],[3,6],[2,7]] */
export function seededMatchups(size: BracketSize): Array<[number, number]> {
  if (size === 8) {
    return [
      [1, 8],
      [4, 5],
      [3, 6],
      [2, 7],
    ];
  }
  return [
    [1, 16],
    [8, 9],
    [5, 12],
    [4, 13],
    [6, 11],
    [3, 14],
    [7, 10],
    [2, 15],
  ];
}

export type RenderBracketOpts = {
  /** Ranked tracks in finishing order — index 0 is #1. Must contain at
   *  least `size` tracks; extras are ignored. */
  tracks: PoolEntry[];
  size: BracketSize;
  /** Footer host shown on the card. Defaults to the upstream deploy. */
  shareHost?: string;
};

/** Render the bracket to a PNG Blob. */
export async function renderBracket(opts: RenderBracketOpts): Promise<Blob> {
  if (opts.tracks.length < opts.size) {
    throw new Error(
      `Bracket needs ${opts.size} tracks, got ${opts.tracks.length}.`,
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");

  // ---------- Background ----------
  // Same gradient family as the tier cards but tinted emerald — the
  // bracket is the "championship" view, distinct from per-tier cards.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "rgba(16, 185, 129, 0.18)");
  bg.addColorStop(0.35, "#0a0a0d");
  bg.addColorStop(1, "#000");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Top accent stripe.
  ctx.fillStyle = "#10b981";
  ctx.fillRect(0, 0, W, 10);

  // ---------- Header ----------
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#10b981";
  ctx.font = "600 24px system-ui, -apple-system, sans-serif";
  ctx.fillText("B R A C K E T E E R I N G", PAD, 86);

  ctx.fillStyle = "#fff";
  ctx.font = "800 88px system-ui, -apple-system, sans-serif";
  ctx.fillText(`My Top ${opts.size}`, PAD, 178);

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "400 26px system-ui, -apple-system, sans-serif";
  ctx.fillText("Single-elimination · seeded by rank", PAD, 218);

  // ---------- Tracks setup ----------
  const seeds = opts.tracks.slice(0, opts.size);
  const matchups = seededMatchups(opts.size);

  // Pre-load all album art in parallel so the export stays under ~1s on
  // typical mobile connections.
  const arts = await Promise.all(
    seeds.map((t) => loadImage(t.album.images?.[0]?.url ?? "")),
  );

  // ---------- Bracket geometry ----------
  // Body: header bottom (~250) → footer top. 5 columns for 16 (R16, R8,
  // R4, R2, Champion); 4 for 8.
  const bodyTop = 260;
  const bodyBottom = H - FOOTER_H;
  const bodyH = bodyBottom - bodyTop;
  const colCount = opts.size === 16 ? 5 : 4;
  const colW = (W - PAD * 2) / colCount;

  // Round-1 cell heights are sized so all `size` cells fit in bodyH with
  // a small gap. Subsequent rounds halve the count and double the spacing
  // so winners line up vertically with the midpoint of their two feeders.
  const r1Cells = opts.size;
  const cellH = (bodyH - (r1Cells - 1) * 6) / r1Cells;
  const cellW = colW - 16;

  // Center y of the i-th cell in `round`. Round 0 has `size` cells each
  // taking one r1-slot; each subsequent round halves the count and the
  // cell sits at the midpoint of the 2^round r1-slots it covers.
  // Single source of truth — both cellPos and drawConnectors derive
  // their y values from this helper so they can never disagree.
  function centerY(round: number, i: number): number {
    const groupSize = Math.pow(2, round);
    const r1StartIdx = i * groupSize;
    const r1EndIdx = (i + 1) * groupSize - 1;
    const yStart = bodyTop + r1StartIdx * (cellH + 6);
    const yEnd = bodyTop + r1EndIdx * (cellH + 6) + cellH;
    return (yStart + yEnd) / 2;
  }

  function cellPos(round: number, i: number): { x: number; y: number; w: number; h: number } {
    const x = PAD + round * colW + 8;
    return { x, y: centerY(round, i) - cellH / 2, w: cellW, h: cellH };
  }

  // ---------- Round 1: draw the seeded matchups ----------
  // Walk matchups in display order. Each matchup contributes 2 cells
  // stacked vertically — the higher seed (lower rank number) advances.
  const winnersByRound: Array<Array<{ rank: number; track: PoolEntry; art: HTMLImageElement | null }>> = [[]];
  let r1Slot = 0;
  for (const [a, b] of matchups) {
    const aTrack = seeds[a - 1];
    const bTrack = seeds[b - 1];
    const aArt = arts[a - 1];
    const bArt = arts[b - 1];

    // Cell A (top of matchup)
    const cellA = cellPos(0, r1Slot);
    drawSeedCell(ctx, cellA.x, cellA.y, cellA.w, cellA.h, a, aTrack, aArt, true);
    r1Slot++;

    // Cell B (bottom of matchup)
    const cellB = cellPos(0, r1Slot);
    drawSeedCell(ctx, cellB.x, cellB.y, cellB.w, cellB.h, b, bTrack, bArt, false);
    r1Slot++;

    // Higher seed (smaller rank number) wins.
    const winnerRank = a < b ? a : b;
    const winnerTrack = a < b ? aTrack : bTrack;
    const winnerArt = a < b ? aArt : bArt;
    winnersByRound[0].push({ rank: winnerRank, track: winnerTrack, art: winnerArt });
  }

  // ---------- Subsequent rounds ----------
  for (let round = 1; round < colCount; round++) {
    winnersByRound[round] = [];
    const prev = winnersByRound[round - 1];
    for (let i = 0; i < prev.length; i += 2) {
      const a = prev[i];
      const b = prev[i + 1];
      const winner = a.rank < b.rank ? a : b;
      const cell = cellPos(round, i / 2);
      const isFinal = round === colCount - 1;
      drawAdvanceCell(
        ctx,
        cell.x,
        cell.y,
        cell.w,
        cell.h,
        winner.rank,
        winner.track,
        winner.art,
        isFinal,
      );
      winnersByRound[round].push(winner);
    }

    // Draw the connector lines from the previous round's winners into
    // this round's cells. A small horizontal line off each prev cell
    // converges to the midpoint, then a vertical join, then a short
    // horizontal into the new cell.
    drawConnectors(ctx, round, opts.size, colW, cellW, centerY);
  }

  // ---------- Round labels ----------
  // Subtle headers above each column so viewers can read the bracket.
  ctx.fillStyle = "#52525b";
  ctx.font = "600 16px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  const labels =
    opts.size === 16
      ? ["Round of 16", "Quarterfinals", "Semifinals", "Final", "Champion"]
      : ["Quarterfinals", "Semifinals", "Final", "Champion"];
  for (let r = 0; r < colCount; r++) {
    const cx = PAD + r * colW + colW / 2;
    ctx.fillText(labels[r].toUpperCase(), cx, bodyTop - 14);
  }
  ctx.textAlign = "left";

  // ---------- Footer ----------
  ctx.fillStyle = "#71717a";
  ctx.font = "500 24px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Rank yours →", W / 2, H - 60);
  ctx.fillStyle = "#52525b";
  ctx.font = "400 20px system-ui, -apple-system, sans-serif";
  ctx.fillText(opts.shareHost ?? "jhomer192.github.io/bracketeering", W / 2, H - 32);
  ctx.textAlign = "left";

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png",
    );
  });
}

// ---------- cell renderers ----------

function drawSeedCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  track: PoolEntry,
  art: HTMLImageElement | null,
  isTopOfMatchup: boolean,
) {
  // Background plate — the loser will be dimmed below (we know which
  // seed loses purely from rank, so we could pre-style here, but it's
  // cleaner to render both equally and overlay an "out" mark on losers
  // in advance-rounds via the connector logic).
  void isTopOfMatchup;
  drawCellBox(ctx, x, y, w, h, "#18181b", "#27272a");
  drawCellContent(ctx, x, y, w, h, seed, track, art, /* dimmed */ false);
}

function drawAdvanceCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  track: PoolEntry,
  art: HTMLImageElement | null,
  isChampion: boolean,
) {
  if (isChampion) {
    drawCellBox(ctx, x, y, w, h, "rgba(245, 158, 11, 0.22)", "#f59e0b");
  } else {
    drawCellBox(ctx, x, y, w, h, "#1c1c20", "#3f3f46");
  }
  drawCellContent(ctx, x, y, w, h, seed, track, art, false);
  if (isChampion) {
    // Champion crown badge — small ★ in the top-right of the cell.
    ctx.fillStyle = "#f59e0b";
    ctx.font = "700 18px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("★", x + w - 6, y + 16);
    ctx.textAlign = "left";
  }
}

function drawCellBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
) {
  roundedRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawCellContent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  track: PoolEntry,
  art: HTMLImageElement | null,
  dimmed: boolean,
) {
  const alpha = dimmed ? 0.45 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;

  const artSize = h - 8;
  const artX = x + 4;
  const artY = y + 4;
  if (art) {
    drawRoundedImage(ctx, art, artX, artY, artSize, artSize, 4);
  } else {
    roundedRect(ctx, artX, artY, artSize, artSize, 4);
    ctx.fillStyle = "#27272a";
    ctx.fill();
  }

  // Seed badge — small numbered chip on top-left of the album art.
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  roundedRect(ctx, artX + 2, artY + 2, 22, 14, 3);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "700 10px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(seed), artX + 13, artY + 9);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Track + artist text.
  const textX = artX + artSize + 8;
  const textMaxW = w - (textX - x) - 6;
  ctx.fillStyle = "#fff";
  ctx.font = "600 13px system-ui, -apple-system, sans-serif";
  ctx.fillText(truncate(ctx, track.name, textMaxW), textX, y + h / 2 - 2);
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "400 11px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    truncate(ctx, track.artists.map((a) => a.name).join(", "), textMaxW),
    textX,
    y + h / 2 + 12,
  );

  ctx.restore();
}

// ---------- connectors ----------

function drawConnectors(
  ctx: CanvasRenderingContext2D,
  round: number,
  size: BracketSize,
  colW: number,
  cellW: number,
  centerY: (round: number, i: number) => number,
) {
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  // Pairs of cells from round (round-1) merge into one cell in `round`.
  const prevRound = round - 1;
  const prevCount = size / Math.pow(2, prevRound);
  for (let i = 0; i < prevCount; i += 2) {
    const yA = centerY(prevRound, i);
    const yB = centerY(prevRound, i + 1);
    const xRight = PAD + prevRound * colW + 8 + cellW;
    const xMid = PAD + prevRound * colW + 8 + cellW + (colW - cellW) / 2;
    const xLeftNext = PAD + round * colW + 8;

    ctx.beginPath();
    ctx.moveTo(xRight, yA);
    ctx.lineTo(xMid, yA);
    ctx.lineTo(xMid, yB);
    ctx.lineTo(xRight, yB);
    ctx.stroke();

    const yMid = (yA + yB) / 2;
    ctx.beginPath();
    ctx.moveTo(xMid, yMid);
    ctx.lineTo(xLeftNext, yMid);
    ctx.stroke();
  }
}

// ---------- canvas helpers (mirror of cardExport.ts) ----------

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawRoundedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.save();
  roundedRect(ctx, x, y, w, h, r);
  ctx.clip();
  drawCoverFit(ctx, img, x, y, w, h);
  ctx.restore();
}

function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ir = img.naturalWidth / img.naturalHeight;
  const dr = w / h;
  let sx = 0,
    sy = 0,
    sw = img.naturalWidth,
    sh = img.naturalHeight;
  if (ir > dr) {
    sw = img.naturalHeight * dr;
    sx = (img.naturalWidth - sw) / 2;
  } else if (ir < dr) {
    sh = img.naturalWidth / dr;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = text.slice(0, mid) + "…";
    if (ctx.measureText(candidate).width <= maxW) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, Math.max(0, lo - 1)) + "…";
}
