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

export async function deleteProject(projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").delete().eq("id", projectId);

  if (error) {
    return { error: error.message };
  }

  redirect("/projects");
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

  if (!userId) {
    return {
      error: `No account found for ${email}. They need to sign in once (via magic link) before they can be added.`,
    };
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
