"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createProject(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) {
    return { error: "Name is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: projectId, error } = await supabase.rpc("create_project", {
    p_name: name,
    p_description: description,
  });

  if (error || !projectId) {
    return { error: error?.message ?? "Failed to create project." };
  }

  redirect(`/projects/${projectId}`);
}
