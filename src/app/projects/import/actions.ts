"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ImportMember = { email: string; role: "member" | "instructor" };
export type ImportRow = {
  name: string;
  description: string | null;
  members: ImportMember[];
};

export type ImportOutcome = {
  name: string;
  projectId?: string;
  invited: number;
  addedDirectly: number;
  error?: string;
  memberErrors: string[];
};

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PROJECTS = 50;
const MAX_MEMBERS = 100;

/**
 * Create a semester's worth of projects in one pass.
 *
 * Everything runs as the signed-in person through the ordinary client, so RLS
 * applies exactly as it does to the New Project form - this is the same two
 * calls the interface already makes, in a loop, and it grants nothing the
 * person could not do by hand.
 *
 * Each project is reported on separately and a failure never stops the run.
 * Six groups on the morning of the first class is the wrong moment to discover
 * that one bad address rolled back the other five; creating four of five and
 * saying plainly which one failed is far easier to finish by hand.
 *
 * The rows are re-checked here rather than trusted. They arrive from the
 * browser, so the parsing the page did is a convenience, not a guarantee.
 */
export async function importProjects(
  rows: ImportRow[]
): Promise<{ error?: string; outcomes: ImportOutcome[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You are signed out. Sign in and try again.", outcomes: [] };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "Nothing to import.", outcomes: [] };
  }

  if (rows.length > MAX_PROJECTS) {
    return {
      error: `That is ${rows.length} projects in one go. The limit is ${MAX_PROJECTS} — split the file if you really mean it.`,
      outcomes: [],
    };
  }

  const outcomes: ImportOutcome[] = [];

  for (const row of rows) {
    const name = (row?.name ?? "").trim();
    if (!name) continue;

    const outcome: ImportOutcome = {
      name,
      invited: 0,
      addedDirectly: 0,
      memberErrors: [],
    };

    const { data: projectId, error: createError } = await supabase.rpc(
      "create_project",
      {
        p_name: name,
        p_description: (row.description ?? "")?.trim() || null,
      }
    );

    if (createError || !projectId) {
      outcome.error = createError?.message ?? "Could not create the project.";
      outcomes.push(outcome);
      continue;
    }

    outcome.projectId = projectId as string;

    const members = (row.members ?? []).slice(0, MAX_MEMBERS);
    const seen = new Set<string>();

    for (const member of members) {
      const email = (member?.email ?? "").trim().toLowerCase();
      const role = member?.role === "instructor" ? "instructor" : "member";

      if (!LOOKS_LIKE_EMAIL.test(email) || seen.has(email)) continue;
      seen.add(email);

      // Same two paths the invite box takes: someone with an account becomes a
      // member now, and everyone else waits as an invitation that is claimed
      // the first time they sign in.
      const { data: userId, error: lookupError } = await supabase.rpc(
        "get_user_id_by_email",
        { target_email: email }
      );

      if (lookupError) {
        outcome.memberErrors.push(`${email}: ${lookupError.message}`);
        continue;
      }

      if (userId) {
        const { error: memberError } = await supabase
          .from("project_members")
          .insert({ project_id: projectId, user_id: userId, role });
        // 23505 is this person already being a member, which is the desired
        // end state - the creator is a member already, so their own address
        // in the file lands here every time.
        if (memberError && memberError.code !== "23505") {
          outcome.memberErrors.push(`${email}: ${memberError.message}`);
          continue;
        }
        if (!memberError) outcome.addedDirectly++;
        continue;
      }

      const { error: inviteError } = await supabase
        .from("project_invitations")
        .insert({ project_id: projectId, email, role, invited_by: user.id });

      if (inviteError && inviteError.code !== "23505") {
        outcome.memberErrors.push(`${email}: ${inviteError.message}`);
        continue;
      }
      if (!inviteError) outcome.invited++;
    }

    outcomes.push(outcome);
  }

  revalidatePath("/projects");
  return { outcomes };
}
