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
function CallbackNotice() {
  const reason = useSearchParams().get("reason");
  if (reason !== "expired" && reason !== "failed") return null;

  return (
    <p className="rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink-secondary">
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="display text-xl">Urban Lab Map</h1>
        <p className="text-sm text-neutral-500">
          Sign in with a magic link — no password needed.
        </p>
      </div>

      <CallbackNotice />

      {status === "sent" ? (
        <p className="text-sm">
          Check <strong>{email}</strong> for a sign-in link.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="you@bezalel.ac.il"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="press rounded-md bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
          {status === "error" && (
            <p className="text-sm text-red-600">
              Couldn&rsquo;t send the link{detail ? `: ${detail}` : "."}
            </p>
          )}
        </form>
      )}
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
