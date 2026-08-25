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

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const destination = resolveDestination(searchParams.get("next"), origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(destination, origin));
    }
  }

  return NextResponse.redirect(new URL("/login", origin));
}
