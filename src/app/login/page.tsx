"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The levels a project is organised into, in the students' own words.
 *
 * This is the one thing on the page that says what the tool is for, and it is
 * real content rather than decoration: the indent is the containment, so the
 * shape of the list is the shape of an archive. No invented accession codes -
 * nothing here should read as a record that exists.
 */
const LEVELS = [
  { term: "נושא", gloss: "subject", indent: 0 },
  { term: "סדרה", gloss: "series", indent: 1 },
  { term: "תת-סדרה", gloss: "sub-series", indent: 2 },
  { term: "תיק", gloss: "file", indent: 3 },
  { term: "פריט", gloss: "item", indent: 4 },
];

/**
 * Why the callback sent someone back here.
 *
 * Only our own two reasons are recognised and each maps to fixed text -
 * nothing from the query string is rendered, so a crafted link cannot put
 * words on the sign-in page.
 */
function CallbackNotice() {
  const reason = useSearchParams().get("reason");
  if (reason !== "expired" && reason !== "failed") return null;

  return (
    <p className="border-l-2 border-rule pl-3 text-sm text-ink-secondary">
      {reason === "expired"
        ? "That sign-in link had expired or was already used. Links last about an hour and work once — send a fresh one below."
        : "That sign-in link couldn't be used. Send a fresh one below."}
    </p>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  // Supabase's own words for what went wrong. "Something went wrong" sent you
  // looking in the wrong place: the two real causes here - this origin missing
  // from the redirect allow-list, and the hourly cap on the built-in mail
  // sender - are both named plainly in the reply, and neither is fixed by the
  // "try again" the generic message invites. React escapes it on the way in.
  const [detail, setDetail] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setDetail(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setDetail(error.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="display text-3xl">Urban Lab Map</h1>
        <p className="max-w-[46ch] text-[15px] leading-relaxed text-ink-secondary">
          A field archive of the city, made on foot. Groups place what they
          find — photographs, recordings, interviews, notes — on the map at the
          spot where they found it.
        </p>
      </header>

      {/*
        Ruled rows rather than a bordered card: a catalog separates entries
        with a line, and the whole palette is built on that. The indent does
        the explaining, so no numbering is needed - these are nested levels,
        not a sequence of steps.
      */}
      <dl className="flex flex-col border-t border-rule">
        {LEVELS.map((level) => (
          <div
            key={level.term}
            className="flex items-baseline justify-between gap-6 border-b border-rule py-2"
          >
            {/*
              A physical padding-left, not paddingInlineStart. dir="auto"
              resolves these Hebrew terms to RTL, which is right for the word
              but makes the inline start the right-hand edge - the indent then
              lands on the far side and every term lines up flush, which is
              the one thing this list must not do. The row itself is laid out
              left to right, so the nesting is read from the left.
            */}
            <dt
              dir="auto"
              className="text-[15px] text-ink"
              style={{ paddingLeft: `${level.indent * 1.1}rem` }}
            >
              {level.term}
            </dt>
            {/*
              Sentence case, not the uppercase of .label. Five tracked-out caps
              stacked in a column stop reading as information and start reading
              as texture - and the Hebrew term is what carries this row.
            */}
            <dd className="font-mono text-[11px] tracking-wider text-ink-muted">
              {level.gloss}
            </dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="display text-lg">Sign in</h2>
          <p className="text-sm text-ink-secondary">
            We&rsquo;ll email you a link. No password to remember.
          </p>
        </div>

        <CallbackNotice />

        {status === "sent" ? (
          <p className="border-l-2 border-ink pl-3 text-sm text-ink">
            Link sent. Check <strong className="font-medium">{email}</strong> —
            it works once, and lasts about an hour.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="you@bezalel.ac.il"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-ink-muted"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="press self-start rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Email me a link"}
            </button>
            {status === "error" && (
              <p className="text-sm text-red-700">
                Couldn&rsquo;t send the link{detail ? `: ${detail}` : "."}
              </p>
            )}
          </form>
        )}
      </section>
    </main>
  );
}

// useSearchParams needs a Suspense boundary, or the whole route opts out of
// prerendering.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
