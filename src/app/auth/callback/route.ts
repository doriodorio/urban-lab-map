import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_DESTINATION = "/projects";

/**
 * Resolves the `next` query parameter to a path on this site, or falls back.
 *
 * The naive version of this - `${origin}${next}` - is an open redirect.
 * `origin` carries no trailing slash, so a `next` that doesn't begin with "/"
 * lands in the *authority* half of the URL: with `next=@evil.com` the string
 * becomes `https://your-app.example@evil.com`, which a URL parser reads as
 * userinfo `your-app.example` and host `evil.com`. The victim is sent
 * off-site with your domain sitting in the link.
 *
 * Rather than pattern-matching the ways that can go wrong ("//", "\", encoded
 * variants, and whatever comes next), this resolves the value against the
 * real origin and simply refuses anything that doesn't land back here. The
 * URL parser is the authority on what a string means, so it decides. Only the
 * path is reused, never the caller's raw text.
 */
function resolveDestination(next: string | null, origin: string): string {
  if (!next) return DEFAULT_DESTINATION;

  try {
    const resolved = new URL(next, origin);
    if (resolved.origin !== origin) return DEFAULT_DESTINATION;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return DEFAULT_DESTINATION;
  }
}

/**
 * Sends the reader back to sign in, saying why.
 *
 * Silently bouncing to a blank sign-in page is indistinguishable from the app
 * being broken - and the most common reason is a link that expired or was
 * already opened, which the person can fix themselves the moment they are
 * told. Mail scanners that prefetch links are a routine cause: the token is
 * single-use, so a preview fetch can burn it before the human clicks.
 *
 * `reason` is our own text, never the provider's - an error string from a
 * query parameter would otherwise be reflected onto the page.
 */
function backToLogin(origin: string, reason: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const destination = resolveDestination(searchParams.get("next"), origin);

  // Supabase reports a refused link by redirecting here with its own error
  // parameters rather than a code.
  const errorCode = searchParams.get("error_code");
  if (errorCode) {
    return backToLogin(
      origin,
      errorCode === "otp_expired" ? "expired" : "failed"
    );
  }

  if (!code) {
    return backToLogin(origin, "failed");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return backToLogin(origin, "failed");
  }

  // Turn any invitations addressed to this person into memberships, now that
  // there is finally an account to attach them to. Failure is deliberately
  // ignored: being signed in matters more than being enrolled this second, and
  // the projects page claims again on load.
  await supabase.rpc("claim_project_invitations");

  return NextResponse.redirect(new URL(destination, origin));
}
