"use client";

// Predict-my-top-10 — public page (no Spotify auth required).
//
// URL contract: /predict/?t=id1,id2,...,id10 with IDs in true rank order.
// Page loads metadata via Spotify oEmbed, shuffles the 10 cards for
// display, lets the visitor reorder them, and shows a score on submit.

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  fetchPredictMeta,
  parsePredictParam,
  scoreGuess,
  seedFromIds,
  shuffleStable,
  type PredictMeta,
  type PredictScore,
} from "@/lib/predict";

export default function PredictPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  // null = loading, [] = no/invalid link, populated = ready
  const [trueIds, setTrueIds] = useState<string[] | null>(null);
  const [meta, setMeta] = useState<PredictMeta[] | null>(null);
  const [order, setOrder] = useState<string[]>([]); // current guess, list of IDs
  const [submitted, setSubmitted] = useState<PredictScore | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Parse URL once on mount; build the (deterministic) shuffled starting
  // order so refresh keeps the same layout.
  useEffect(() => {
    const url = new URL(window.location.href);
    const ids = parsePredictParam(url.searchParams.get("t"));
    if (ids.length < 4) {
      setTrueIds([]);
      return;
    }
    setTrueIds(ids);
    const seed = seedFromIds(ids);
    setOrder(shuffleStable(ids, seed));
  }, []);

  // Fetch oEmbed metadata in parallel once we have the ID list.
  useEffect(() => {
    if (!trueIds || trueIds.length === 0) return;
    let cancelled = false;
    Promise.all(
      trueIds.map((id) =>
        fetchPredictMeta(id).catch(
          (): PredictMeta => ({
            id,
            title: "Unknown track",
            artist: "",
            thumbnailUrl: null,
          }),
        ),
      ),
    )
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Couldn't load tracks.");
      });
    return () => {
      cancelled = true;
    };
  }, [trueIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const metaById = useMemo(() => {
    const m = new Map<string, PredictMeta>();
    if (meta) for (const t of meta) m.set(t.id, t);
    return m;
  }, [meta]);

  function handleDragEnd(event: DragEndEvent) {
    if (submitted) return; // locked after submit
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((items) => {
      const oldIndex = items.indexOf(String(active.id));
      const newIndex = items.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  }

  function onSubmit() {
    if (!trueIds || order.length !== trueIds.length) return;
    setSubmitted(scoreGuess(trueIds, order));
  }

  function onReset() {
    if (!trueIds) return;
    setSubmitted(null);
    setOrder(shuffleStable(trueIds, seedFromIds(trueIds)));
  }

  async function shareScore() {
    if (!submitted) return;
    const text =
      `I scored ${submitted.percent}% on a Songrank predict-my-top-10 ` +
      `(${submitted.exact}/10 exact, ${submitted.pairs}/45 pair-order). ` +
      `Rank your own: ${window.location.origin}${basePath}/`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy:", text);
    }
  }

  // ----- Render guards -----

  if (trueIds === null) return <Loading />;
  if (trueIds.length === 0) {
    return (
      <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4">
          <p className="text-zinc-300">This link doesn&apos;t look like a valid predict-my-top-10.</p>
          <p className="text-zinc-500 text-sm">
            Predict links look like <code className="text-zinc-400">/predict/?t=…</code> with at
            least 4 track IDs. Ask your friend to re-share.
          </p>
          <a href={`${basePath}/`} className="text-emerald-400 underline">
            Bracketeer your own →
          </a>
        </div>
      </main>
    );
  }
  if (err) {
    return (
      <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-3">
          <p className="text-red-400">Couldn&apos;t load track info.</p>
          <p className="text-zinc-500 text-sm break-all">{err}</p>
        </div>
      </main>
    );
  }
  if (!meta) {
    return (
      <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="text-zinc-400">Loading the {trueIds.length} tracks…</div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="border-b border-zinc-800">
        <div className="max-w-2xl mx-auto px-4 py-4 sm:py-5">
          <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-400 font-semibold">
            B R A C K E T E E R I N G
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
            Predict their Top {trueIds.length}
          </h1>
          <p className="text-zinc-500 text-xs sm:text-sm mt-1">
            {submitted
              ? "Here's how close you got."
              : "Drag the cards into the order you think they ranked them. No peeking 👀"}
          </p>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Press space or enter to pick up a track. Use arrow keys to move. Press space or enter to drop, or escape to cancel.",
          },
          announcements: {
            onDragStart: ({ active }) => `Picked up track at position.`,
            onDragOver: ({ active, over }) =>
              over ? `Track is now over position ${order.indexOf(String(over.id)) + 1}.` : "",
            onDragEnd: ({ over }) =>
              over
                ? `Dropped at position ${order.indexOf(String(over.id)) + 1}.`
                : `Returned to original position.`,
            onDragCancel: () => `Reorder cancelled.`,
          },
        }}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="max-w-2xl mx-auto px-3 sm:px-4 mt-4 space-y-1.5">
            {order.map((id, i) => {
              const m = metaById.get(id);
              const guessRank = i + 1;
              const trueRank = (trueIds.indexOf(id) ?? 0) + 1;
              const showTruth = !!submitted;
              const correct = showTruth && guessRank === trueRank;
              return (
                <SortableTrackRow
                  key={id}
                  id={id}
                  meta={m}
                  guessRank={guessRank}
                  trueRank={showTruth ? trueRank : null}
                  correct={correct}
                  locked={!!submitted}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>

      <section className="max-w-2xl mx-auto px-3 sm:px-4 mt-6">
        {submitted ? (
          <div className="space-y-4">
            <ScoreCard score={submitted} total={trueIds.length} />
            <div className="flex gap-2">
              <button
                onClick={onReset}
                className="flex-1 h-12 rounded-full bg-zinc-800 active:bg-zinc-700 text-zinc-100 font-semibold"
              >
                Try again
              </button>
              <button
                onClick={shareScore}
                className="flex-1 h-12 rounded-full bg-[#1DB954] active:bg-[#1ed760] text-black font-semibold"
              >
                {copied ? "copied ✓" : "Share my score"}
              </button>
            </div>
            <a
              href={`${basePath}/`}
              className="block text-center text-xs text-zinc-500 hover:text-zinc-300 underline"
            >
              Bracketeer your own →
            </a>
          </div>
        ) : (
          <button
            onClick={onSubmit}
            className="w-full h-14 rounded-full bg-[#1DB954] active:bg-[#1ed760] text-black font-semibold text-lg"
          >
            Lock it in →
          </button>
        )}
      </section>
    </main>
  );
}

function Loading() {
  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center">
      <div className="text-zinc-400">Loading…</div>
    </main>
  );
}

type VerdictTone = "emerald" | "lime" | "amber" | "orange" | "rose";

const VERDICT_RING: Record<VerdictTone, { border: string; gradient: string; text: string }> = {
  emerald: { border: "border-emerald-500/60", gradient: "from-emerald-950/40", text: "text-emerald-200" },
  lime: { border: "border-lime-500/60", gradient: "from-lime-950/40", text: "text-lime-200" },
  amber: { border: "border-amber-500/60", gradient: "from-amber-950/40", text: "text-amber-200" },
  orange: { border: "border-orange-500/60", gradient: "from-orange-950/40", text: "text-orange-200" },
  rose: { border: "border-rose-500/60", gradient: "from-rose-950/40", text: "text-rose-200" },
};

function ScoreCard({ score, total }: { score: PredictScore; total: number }) {
  // Verdict tone scales with the score so the result feels earned, not generic.
  // Below 30% reads as random-guessing; above 80% means they really know you.
  const verdict: { label: string; tone: VerdictTone } =
    score.percent >= 80
      ? { label: "You actually know them.", tone: "emerald" }
      : score.percent >= 60
        ? { label: "Close — you've got the shape right.", tone: "lime" }
        : score.percent >= 40
          ? { label: "Decent guess. Some surprises in there.", tone: "amber" }
          : score.percent >= 20
            ? { label: "Way off. Are you sure you know them?", tone: "orange" }
            : { label: "Brutal. Random would do better.", tone: "rose" };
  const ring = VERDICT_RING[verdict.tone];
  const totalPairs = (total * (total - 1)) / 2;
  return (
    <div
      className={`rounded-2xl border ${ring.border} bg-gradient-to-br ${ring.gradient} via-zinc-900/40 to-zinc-900/40 p-5 sm:p-6`}
    >
      <p className={`text-[10px] uppercase tracking-[0.22em] font-semibold ${ring.text}`}>
        Verdict
      </p>
      <p className="text-2xl sm:text-3xl font-bold mt-1">{verdict.label}</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Score" value={`${score.percent}%`} />
        <Stat label="Exact" value={`${score.exact}/${total}`} />
        <Stat label="Pair order" value={`${score.pairs}/${totalPairs}`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}

function SortableTrackRow({
  id,
  meta,
  guessRank,
  trueRank,
  correct,
  locked,
}: {
  id: string;
  meta: PredictMeta | undefined;
  guessRank: number;
  trueRank: number | null;
  correct: boolean;
  locked: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: locked });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.92 : 1,
    touchAction: locked ? undefined : "none",
  };

  // Reveal-mode color: green if exact match, soft amber otherwise so the
  // grid still reads as a result and not a "you failed" wall of red.
  const tone = trueRank
    ? correct
      ? "border-emerald-500/60 bg-emerald-950/40"
      : "border-zinc-700 bg-zinc-900/50"
    : "border-zinc-800 bg-zinc-900/40";

  return (
    <li ref={setNodeRef} style={dragStyle}>
      <div
        className={`flex items-center gap-2.5 rounded-lg border ${tone} p-1.5 pr-3 ${
          isDragging ? "shadow-2xl shadow-emerald-500/20 ring-1 ring-emerald-500/40" : ""
        }`}
      >
        <div
          className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-mono text-[11px] sm:text-xs tabular-nums font-semibold flex-none ${
            correct
              ? "bg-emerald-500 text-black"
              : trueRank
                ? "bg-zinc-700 text-zinc-200"
                : "bg-zinc-800 text-zinc-300"
          }`}
        >
          {guessRank}
        </div>
        {meta?.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.thumbnailUrl}
            alt=""
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-md object-cover flex-none"
          />
        ) : (
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-md bg-zinc-800 flex-none" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm leading-tight truncate">
            {meta?.title ?? "Loading…"}
          </div>
          <div className="text-[11px] sm:text-xs text-zinc-500 leading-tight truncate mt-0.5">
            {meta?.artist ?? ""}
          </div>
        </div>
        {trueRank ? (
          <div
            className={`flex-none text-[11px] font-semibold ${
              correct ? "text-emerald-400" : "text-zinc-400"
            }`}
            aria-label={`Truly ranked ${trueRank}`}
          >
            {correct ? "✓" : `actual #${trueRank}`}
          </div>
        ) : (
          <button
            type="button"
            aria-label={`Drag to reorder`}
            className="flex-none w-9 h-9 -mr-1 flex items-center justify-center text-zinc-400 hover:text-zinc-200 cursor-grab active:cursor-grabbing select-none touch-none"
            {...attributes}
            {...listeners}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false">
              <circle cx="5" cy="3" r="1.4" fill="currentColor" />
              <circle cx="11" cy="3" r="1.4" fill="currentColor" />
              <circle cx="5" cy="8" r="1.4" fill="currentColor" />
              <circle cx="11" cy="8" r="1.4" fill="currentColor" />
              <circle cx="5" cy="13" r="1.4" fill="currentColor" />
              <circle cx="11" cy="13" r="1.4" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
}
