"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error?: string; success?: boolean };

export async function updateProject(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  // The opening the public view leads with.
  const statement = (formData.get("statement") as string)?.trim() || null;
  const coverImageUrl =
    (formData.get("cover_image_url") as string)?.trim() || null;
  const docoUrl = (formData.get("doco_url") as string)?.trim() || null;

  if (!name) {
    return { error: "Name is required." };
  }
  // Both are put straight into the page - the cover as an <img> src, the film
  // through the embed parser - so anything that is not an http(s) URL is
  // refused here rather than trusted from the form.
  for (const [label, value] of [
    ["cover image", coverImageUrl],
    ["film link", docoUrl],
  ] as const) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("bad protocol");
      }
    } catch {
      return { error: `The ${label} must be a link starting http:// or https://` };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      name,
      description,
      statement,
      cover_image_url: coverImageUrl,
      doco_url: docoUrl,
    })
    .eq("id", projectId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

// Slugs are readable-but-unguessable: a name-derived prefix so a shared link
// says what it is, plus random suffix so a published project can't be found
// by guessing another group's project name.
function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = crypto.randomUUID().split("-")[0];
  return base ? `${base}-${suffix}` : suffix;
}

export async function publishProject(projectId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: project, error: readError } = await supabase
    .from("projects")
    .select("name, public_slug")
    .eq("id", projectId)
    .maybeSingle();

  if (readError) {
    return { error: readError.message };
  }
  if (!project) {
    return { error: "Project not found." };
  }
  // Keep an existing slug so re-publishing doesn't break links already shared.
  if (project.public_slug) {
    return { success: true };
  }

  const { error } = await supabase
    .from("projects")
    .update({ public_slug: slugify(project.name) })
    .eq("id", projectId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/settings`);
  return { success: true };
}

export async function unpublishProject(
  projectId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ public_slug: null })
    .eq("id", projectId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/settings`);
  return { success: true };
}

/**
 * Move a project to the trash.
 *
 * Was a hard delete any member could run, which cascaded away every layer,
 * item, link and thread with no undo, and left the uploaded files behind
 * unreachable. Now it hides the project and stops its public link, and any
 * member can bring it back.
 */
export async function deleteProject(projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) {
    return { error: error.message };
  }

  redirect("/projects");
}

export async function restoreProject(projectId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: null })
    .eq("id", projectId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/projects");
  return { success: true };
}

/**
 * Destroy a trashed project for good, and its uploaded files with it.
 *
 * The administrator's alone - restoring is any member's, because an accident
 * should be undoable by whoever had it, but the step that actually ends the
 * work is not. Enforced by the projects_delete_administrator policy; the
 * checks here exist to say why rather than fail as "0 rows affected".
 *
 * Files first, deliberately. Deleting the row makes them unreachable forever:
 * the storage delete policy asks whether you belong to the project named in
 * the path, and there would no longer be such a project. If the file sweep
 * fails, the project stays in the trash and can be tried again.
 */
export async function purgeProject(projectId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: project, error: readError } = await supabase
    .from("projects")
    .select("id, deleted_at")
    .eq("id", projectId)
    .maybeSingle();

  if (readError) return { error: readError.message };
  if (!project) return { error: "Project not found." };
  if (!project.deleted_at) {
    return { error: "Delete the project first — only trashed projects can be purged." };
  }

  const bucket = supabase.storage.from("project-media");
  const { data: files, error: listError } = await bucket.list(projectId, {
    limit: 1000,
  });

  if (listError) return { error: listError.message };

  if (files && files.length > 0) {
    const { error: removeError } = await bucket.remove(
      files.map((f) => `${projectId}/${f.name}`)
    );
    if (removeError) return { error: removeError.message };
  }

  const { error: deleteError, count } = await supabase
    .from("projects")
    .delete({ count: "exact" })
    .eq("id", projectId);

  if (deleteError) return { error: deleteError.message };
  if (count === 0) {
    return { error: "Only an administrator can permanently delete a project." };
  }

  revalidatePath("/projects");
  return { success: true };
}

export async function cancelInvitation(
  projectId: string,
  email: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_invitations")
    .delete()
    .eq("project_id", projectId)
    .eq("email", email);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/settings`);
  return { success: true };
}

export async function inviteMember(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();

  if (!email) {
    return { error: "Email is required." };
  }

  const supabase = await createClient();

  const { data: userId, error: lookupError } = await supabase.rpc(
    "get_user_id_by_email",
    { target_email: email }
  );

  if (lookupError) {
    return { error: lookupError.message };
  }

  // Never signed in. Record the invitation against the address instead of
  // refusing: groups are formed from a list of emails before term starts, and
  // making a teacher chase six groups to log in first - so that they can then
  // be added - is the wrong way round.
  if (!userId) {
    const { error: inviteError } = await supabase
      .from("project_invitations")
      .insert({ project_id: projectId, email });

    if (inviteError) {
      if (inviteError.code === "23505") {
        return { error: `${email} has already been invited.` };
      }
      return { error: inviteError.message };
    }

    revalidatePath(`/projects/${projectId}/settings`);
    return { success: true };
  }

  const { error: insertError } = await supabase
    .from("project_members")
    .insert({ project_id: projectId, user_id: userId });

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: `${email} is already a member.` };
    }
    return { error: insertError.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function removeMember(projectId: string, userId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}
