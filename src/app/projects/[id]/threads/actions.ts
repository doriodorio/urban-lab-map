"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error?: string; success?: boolean };

export async function createThread(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) {
    return { error: "Name is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("threads")
    .insert({ project_id: projectId, name, description });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/threads`);
  return { success: true };
}

export async function updateThread(
  projectId: string,
  threadId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) {
    return { error: "Name is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("threads")
    .update({ name, description })
    .eq("id", threadId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/threads`);
  return { success: true };
}

export async function deleteThread(projectId: string, threadId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("threads").delete().eq("id", threadId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/threads`);
  return { success: true };
}

// Appends to the end. order_index values are only ever compared, never
// assumed contiguous, so gaps left by removals are harmless.
export async function addItemToThread(
  projectId: string,
  threadId: string,
  itemId: string
): Promise<ActionResult> {
  if (!itemId) {
    return { error: "Choose an item to add." };
  }

  const supabase = await createClient();

  const { data: last, error: lastError } = await supabase
    .from("thread_items")
    .select("order_index")
    .eq("thread_id", threadId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastError) {
    return { error: lastError.message };
  }

  const { error } = await supabase.from("thread_items").insert({
    thread_id: threadId,
    item_id: itemId,
    order_index: (last?.order_index ?? -1) + 1,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "That item is already a step in this thread." };
    }
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/threads`);
  return { success: true };
}

export async function removeItemFromThread(
  projectId: string,
  threadId: string,
  itemId: string
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("thread_items")
    .delete()
    .eq("thread_id", threadId)
    .eq("item_id", itemId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/threads`);
  return { success: true };
}

// Swaps a step with its neighbour. Two rows change, and thread_items has no
// unique constraint on order_index, so a transient duplicate between the two
// updates is fine - order is fully determined again once both land.
export async function moveThreadItem(
  projectId: string,
  threadId: string,
  itemId: string,
  direction: "up" | "down"
): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: steps, error: readError } = await supabase
    .from("thread_items")
    .select("item_id, order_index")
    .eq("thread_id", threadId)
    .order("order_index");

  if (readError) {
    return { error: readError.message };
  }
  if (!steps) {
    return { error: "Couldn't read this thread's steps." };
  }

  const at = steps.findIndex((s) => s.item_id === itemId);
  const swapWith = direction === "up" ? at - 1 : at + 1;

  if (at === -1 || swapWith < 0 || swapWith >= steps.length) {
    return { success: true }; // Already at the end it's being moved toward.
  }

  const a = steps[at];
  const b = steps[swapWith];

  const [{ error: errorA }, { error: errorB }] = await Promise.all([
    supabase
      .from("thread_items")
      .update({ order_index: b.order_index })
      .eq("thread_id", threadId)
      .eq("item_id", a.item_id),
    supabase
      .from("thread_items")
      .update({ order_index: a.order_index })
      .eq("thread_id", threadId)
      .eq("item_id", b.item_id),
  ]);

  if (errorA || errorB) {
    return { error: (errorA ?? errorB)!.message };
  }

  revalidatePath(`/projects/${projectId}/threads`);
  return { success: true };
}

export async function updateNarration(
  projectId: string,
  threadId: string,
  itemId: string,
  narration: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("thread_items")
    .update({ narration: narration.trim() || null })
    .eq("thread_id", threadId)
    .eq("item_id", itemId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/threads`);
  return { success: true };
}
