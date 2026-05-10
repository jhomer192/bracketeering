// Shareable image cards for the reveal page — PNG renders of each tier
// (Top 10 / 25 / 50 / 100 / 128) sized for Instagram / iMessage / Twitter.
//
// Two variants:
//   list   — used for ≤25 tracks: numbered rows with album art + name +
//            artist, like a leaderboard.
//   mosaic — used for >25 tracks: dense album-art grid; track text would
//            be illegibly small at that count, so we lean on the visual.
//
// Output: 1080×1920 PNG (Instagram/Snap Story aspect ratio). Same canvas
// pattern as lib/export.ts; album art loaded with crossOrigin so we can
// read pixels back without tainting.

import type { PoolEntry } from "./pool";

const W = 1080;
const H = 1920;
const PAD = 64;
const FOOTER_H = 140;

export type CardVariant = "list" | "mosaic";

export type RenderCardOpts = {
  tracks: PoolEntry[];
  tierLabel: string; // "Top 10"
  /** Hex color used for the rank medallion / accent. */
  tierAccent: string;
  variant: CardVariant;
};

/** Render a tier card to a PNG Blob. */
export async function renderTierCard(opts: RenderCardOpts): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");

  // ---------- Background ----------
  // Subtle vertical gradient — accent-tinted at top, fading to near-black.
  // Gives the card depth without competing with album art.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, hexWithAlpha(opts.tierAccent, 0.18));
  bg.addColorStop(0.35, "#0a0a0d");
  bg.addColorStop(1, "#000");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Top accent stripe — quick visual signal of which tier this is.
  ctx.fillStyle = opts.tierAccent;
  ctx.fillRect(0, 0, W, 10);

  // ---------- Header ----------
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = opts.tierAccent;
  ctx.font = "600 26px system-ui, -apple-system, sans-serif";
  ctx.letterSpacing = "4px"; // ignored in some browsers; harmless fallback
  ctx.fillText("B R A C K E T E E R I N G", PAD, 110);

  ctx.fillStyle = "#fff";
  ctx.font = "800 110px system-ui, -apple-system, sans-serif";
  ctx.fillText(`My ${opts.tierLabel}`, PAD, 230);

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "400 30px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    opts.variant === "list" ? "Vote-decided ranking" : "Ranking visualised",
    PAD,
    280,
  );

  // ---------- Body ----------
  const bodyTop = 340;
  const bodyBottom = H - FOOTER_H;
  const bodyH = bodyBottom - bodyTop;

  // Pre-load all album art in parallel — the slowest step on a typical
  // mobile connection, so doing it concurrently keeps the export under ~1s.
  const arts = await Promise.all(
    opts.tracks.map((t) => loadImage(t.album.images?.[0]?.url ?? "")),
  );

  if (opts.variant === "list") {
    drawList(ctx, opts.tracks, arts, bodyTop, bodyH, opts.tierAccent);
  } else {
    drawMosaic(ctx, opts.tracks, arts, bodyTop, bodyH);
  }

  // ---------- Footer ----------
  ctx.fillStyle = "#71717a";
  ctx.font = "500 26px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Bracketeer yours →", W / 2, H - 78);
  ctx.fillStyle = "#52525b";
  ctx.font = "400 22px system-ui, -apple-system, sans-serif";
  ctx.fillText("jhomer192.github.io/bracketeering", W / 2, H - 42);
  ctx.textAlign = "left";

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png",
    );
  });
}

// ---------- variant: list ----------

function drawList(
  ctx: CanvasRenderingContext2D,
  tracks: PoolEntry[],
  arts: Array<HTMLImageElement | null>,
  top: number,
  height: number,
  accent: string,
) {
  const n = tracks.length;
  const rowGap = 8;
  const rowH = (height - rowGap * (n - 1)) / n;
  const artSize = Math.min(rowH * 0.92, 132);
  const rankColW = Math.max(80, rowH * 0.7);

  for (let i = 0; i < n; i++) {
    const y = top + i * (rowH + rowGap);
    const t = tracks[i];
    const art = arts[i];

    // Rank medallion — circle with the number, tier-accent colored.
    const rankCx = PAD + rankColW / 2;
    const rankCy = y + rowH / 2;
    const rankR = Math.min(rankColW, rowH) * 0.4;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(rankCx, rankCy, rankR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = `800 ${Math.round(rankR * 0.95)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${i + 1}`, rankCx, rankCy + 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // Album art with rounded corners.
    const artX = PAD + rankColW + 24;
    const artY = y + (rowH - artSize) / 2;
    if (art) {
      drawRoundedImage(ctx, art, artX, artY, artSize, artSize, 14);
    } else {
      roundedRect(ctx, artX, artY, artSize, artSize, 14);
      ctx.fillStyle = "#27272a";
      ctx.fill();
    }

    // Track name + artist, with truncation. Sized so 25-row layout still fits.
    const textX = artX + artSize + 24;
    const textMaxW = W - PAD - textX;
    const titleSize = Math.min(40, Math.round(rowH * 0.32));
    const subSize = Math.min(28, Math.round(rowH * 0.24));

    ctx.fillStyle = "#fff";
    ctx.font = `700 ${titleSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(truncate(ctx, t.name, textMaxW), textX, y + rowH * 0.42);

    ctx.fillStyle = "#a1a1aa";
    ctx.font = `500 ${subSize}px system-ui, -apple-system, sans-serif`;
    const artists = t.artists.map((a) => a.name).join(", ");
    ctx.fillText(truncate(ctx, artists, textMaxW), textX, y + rowH * 0.42 + titleSize + 6);
  }
}

// ---------- variant: mosaic ----------

function drawMosaic(
  ctx: CanvasRenderingContext2D,
  tracks: PoolEntry[],
  arts: Array<HTMLImageElement | null>,
  top: number,
  height: number,
) {
  const n = Math.min(tracks.length, 128);
  // Pick a column count that keeps cells reasonably square within the
  // available 952×height bounding box. Tuned per tier so the densest
  // layout (128) still feels considered.
  let cols: number;
  if (n <= 50) cols = 7;
  else if (n <= 100) cols = 10;
  else cols = 12;
  const rows = Math.ceil(n / cols);
  const innerW = W - PAD * 2;
  const cellW = innerW / cols;
  const cellH = Math.min(cellW, height / rows);
  const gridW = cellW * cols;
  const gridH = cellH * rows;
  const startX = (W - gridW) / 2;
  const startY = top + (height - gridH) / 2;

  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = startX + c * cellW;
    const y = startY + r * cellH;
    const art = arts[i];
    const pad = 2;
    if (art) {
      drawCoverFit(ctx, art, x + pad, y + pad, cellW - pad * 2, cellH - pad * 2);
    } else {
      ctx.fillStyle = "#1c1c20";
      ctx.fillRect(x + pad, y + pad, cellW - pad * 2, cellH - pad * 2);
    }
  }
}

// ---------- canvas helpers ----------

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

/** Draw `img` into (x,y,w,h) with object-fit: cover semantics. */
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
  // Binary chop for an O(log n) trim — much faster than the naive loop
  // when track names get long (Spotify titles can run 60+ chars).
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

function hexWithAlpha(hex: string, alpha: number): string {
  // Accept #rgb / #rrggbb / rgba already-formatted; build "rgba(r,g,b,a)".
  if (hex.startsWith("rgba(") || hex.startsWith("rgb(")) return hex;
  const m = hex.replace("#", "");
  const expanded = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------- share/download ----------

/** Download a Blob as `filename` via a transient anchor. Used as the
 *  fallback when Web Share isn't available (most desktop browsers). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the click has dispatched. Some browsers race if revoked
  // synchronously, dropping the download silently.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Try Web Share with a File first (mobile share sheet → Stories etc.).
 *  Fall back to direct download. Returns the path actually taken so the
 *  UI can pick an appropriate confirmation message. */
export async function shareOrDownloadCard(
  blob: Blob,
  filename: string,
  shareTitle: string,
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
  };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: shareTitle });
      return "shared";
    } catch {
      // User cancelled, or share sheet errored — fall through to download.
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}
