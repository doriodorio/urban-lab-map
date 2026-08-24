"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error?: string; success?: boolean };

export async function updateDisplayName(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const raw = (formData.get("display_name") as string)?.trim();
  const displayName = raw || null;

  if (displayName && displayName.length > 40) {
    return { error: "Keep it under 40 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("profiles")
    .upsert(
      { user_id: user.id, display_name: displayName, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  if (error) {
    return { error: error.message };
  }

  // Names show on items across every project, not just this page.
  revalidatePath("/", "layout");
  return { success: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
