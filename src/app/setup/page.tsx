import Link from "next/link";

const ERR_COPY: Record<string, string> = {
  bad_client_id: "That doesn't look like a Spotify Client ID (should be 32 hex chars).",
  bad_client_secret: "That doesn't look like a Client Secret (should be 32 hex chars).",
  missing_creds: "Your session expired before we could finish. Please paste again.",
};

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const { err } = await searchParams;
  const errMsg = err ? (ERR_COPY[err] ?? `Error: ${err}`) : null;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
  const redirectUri = `${baseUrl}/api/spotify/callback`;

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-50 px-6 py-10 pb-24">
      <div className="max-w-xl mx-auto space-y-8">
        <div>
          <Link href="/" className="text-zinc-500 text-sm hover:text-zinc-300">
            ← back
          </Link>
          <h1 className="text-3xl font-bold mt-2">One-time setup</h1>
          <p className="text-zinc-400 mt-2 leading-relaxed">
            Spotify caps each developer app at 5 friends total. To use Bracketeering
            without that cap, you make your own free Spotify dev app — takes about 90
            seconds — and paste the keys below. We never see anyone else&apos;s music
            data.
          </p>
        </div>

        {errMsg && (
          <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {errMsg}
          </div>
        )}

        <ol className="space-y-5 text-sm">
          <li className="flex gap-3">
            <Step n={1} />
            <div>
              <p>
                Open the Spotify Developer Dashboard:{" "}
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 underline"
                >
                  developer.spotify.com/dashboard
                </a>
              </p>
              <p className="text-zinc-500 mt-1">
                Sign in with your Spotify Premium account if you aren&apos;t already.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <Step n={2} />
            <div>
              <p>Click <strong>Create app</strong> (top right).</p>
            </div>
          </li>

          <li className="flex gap-3">
            <Step n={3} />
            <div>
              <p>Fill in the form:</p>
              <ul className="mt-2 space-y-1 text-zinc-400">
                <li>
                  <span className="text-zinc-300">App name:</span> anything (e.g. &quot;Bracketeering&quot;)
                </li>
                <li>
                  <span className="text-zinc-300">App description:</span> anything
                </li>
                <li>
                  <span className="text-zinc-300">Redirect URI:</span> copy the exact URL below and click <strong>Add</strong>
                </li>
                <li>
                  <span className="text-zinc-300">APIs:</span> check <strong>Web API</strong> only
                </li>
                <li>Accept the Developer Terms of Service → <strong>Save</strong></li>
              </ul>

              <CopyBlock label="Redirect URI" value={redirectUri} />
            </div>
          </li>

          <li className="flex gap-3">
            <Step n={4} />
            <div>
              <p>
                On your new app&apos;s page → click <strong>Settings</strong> (top right).
                Copy the <strong>Client ID</strong>, then click{" "}
                <strong>View client secret</strong> and copy that too.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <Step n={5} />
            <div>
              <p>Paste them here:</p>
            </div>
          </li>
        </ol>

        <form
          method="POST"
          action="/api/setup"
          className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
        >
          <Field
            name="client_id"
            label="Client ID"
            placeholder="32-character hex string"
            autoComplete="off"
          />
          <Field
            name="client_secret"
            label="Client secret"
            placeholder="32-character hex string"
            autoComplete="off"
          />
          <button
            type="submit"
            className="w-full h-12 rounded-full bg-[#1DB954] hover:bg-[#1ed760] active:scale-[0.98] transition text-black font-semibold"
          >
            Connect Spotify →
          </button>
          <p className="text-xs text-zinc-500 text-center">
            Stored encrypted; never shared with anyone else who uses Bracketeering.
          </p>
        </form>
      </div>
    </main>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex-none w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 text-center font-mono text-sm leading-7">
      {n}
    </span>
  );
}

function Field({
  name,
  label,
  placeholder,
  autoComplete,
}: {
  name: string;
  label: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm text-zinc-300 mb-1">{label}</span>
      <input
        name={name}
        type="text"
        required
        spellCheck={false}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full h-11 rounded-lg bg-zinc-950 border border-zinc-800 px-3 font-mono text-sm focus:outline-none focus:border-zinc-600"
      />
    </label>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs break-all">
      <div className="text-zinc-500 text-[10px] uppercase tracking-wide mb-1">{label}</div>
      {value}
    </div>
  );
}
