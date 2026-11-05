"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Why the callback sent someone back here.
 *
 * Only our own two reasons are recognised and each maps to fixed text -
 * nothing from the query string is rendered, so a crafted link cannot put
 * words on the sign-in page.
 */
const NOTICES: Record<string, string> = {
  // Asking again is the commonest way a link dies, and the least obvious: the
  // inbox still shows the old mail, looking perfectly valid.
  expired:
    "That sign-in link had expired. Links last about an hour, and asking for a new one retires the old one immediately — so open the newest mail in your inbox, or send another below.",
  used: "That sign-in link had already been used. Each one works once — send a fresh one below.",
  // The failure that looks like a broken app and is not one.
  verifier:
    "That link was opened in a different browser from the one that asked for it, which is the one thing a sign-in link cannot survive. Ask for a new link below, in this browser, and open it here.",
  failed: "That sign-in link couldn't be used. Send a fresh one below.",
};

function CallbackNotice() {
  const reason = useSearchParams().get("reason");
  const notice = reason ? NOTICES[reason] : undefined;
  if (!notice) return null;

  return (
    <p className="border-l-2 border-rule pl-3 text-sm text-ink-secondary">
      {notice}
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

      <section className="flex flex-col gap-4 border-t border-rule pt-8">
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
