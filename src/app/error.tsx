"use client";

// Root error boundary — catches render-time exceptions anywhere in the app
// tree. Without this, a thrown error in compare/reveal/pool drops the user
// onto a literal blank white page (Next.js dev) or the browser's default
// error UI (production), with no path back. This gives them a way out and
// keeps the brand surface intact.

import { useEffect } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // No telemetry yet — but at least leave a trail in dev tools.
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("[Songrank] render error:", error);
    }
  }, [error]);

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="flex justify-center">
          <LogoMark size={48} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Something broke.</h1>
        <p className="text-zinc-400 text-sm leading-relaxed">
          The bracket hit an error. Your in-progress votes are saved locally —
          you should be able to pick up where you left off.
        </p>
        {error.digest ? (
          <p className="text-zinc-600 text-xs font-mono">ref: {error.digest}</p>
        ) : null}
        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center w-full h-12 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] transition text-emerald-950 font-semibold"
          >
            Try again
          </button>
          <Link
            href={`${basePath}/`}
            className="inline-flex items-center justify-center w-full h-12 rounded-full border border-zinc-700 hover:bg-zinc-900 transition text-zinc-200 text-sm"
          >
            Back to start
          </Link>
        </div>
      </div>
    </main>
  );
}
