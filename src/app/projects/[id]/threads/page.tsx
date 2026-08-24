import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ThreadsManager } from "./threads-manager";
import {
  createThread,
  updateThread,
  deleteThread,
  addItemToThread,
  removeItemFromThread,
  moveThreadItem,
  updateNarration,
} from "./actions";

export default async function ThreadsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [threadsResult, itemsResult] = await Promise.all([
    supabase
      .from("threads")
      .select("id, name, description, created_at")
      .eq("project_id", id)
      .order("created_at"),
    supabase
      .from("items")
      .select("id, title, type, geometry")
      .eq("project_id", id)
      .is("deleted_at", null),
  ]);

  const loadError = threadsResult.error ?? itemsResult.error;
  if (loadError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6">
        <h1 className="text-lg font-semibold">Couldn&apos;t load threads</h1>
        <pre className="overflow-x-auto rounded bg-neutral-100 p-3 text-xs">
          {loadError.message}
        </pre>
        <Link href={`/projects/${id}`} className="text-sm underline">
          ← Map
        </Link>
      </main>
    );
  }

  const threads = threadsResult.data ?? [];
  const items = itemsResult.data ?? [];

  // Steps for every thread in one query rather than N.
  const { data: steps } = threads.length
    ? await supabase
        .from("thread_items")
        .select("thread_id, item_id, order_index, narration")
        .in(
          "thread_id",
          threads.map((t) => t.id)
        )
        .order("order_index")
    : { data: [] };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex items-center gap-3">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-neutral-500 underline"
        >
          ← Map
        </Link>
        <h1 className="text-xl font-semibold">{project.name} — Threads</h1>
      </div>

      <p className="text-sm text-neutral-600">
        A thread orders a subset of your items into a guided sequence, with a
        line of narration for each step. Readers of the published map get the
        thread as a tour they can play through.
      </p>

      <ThreadsManager
        projectId={project.id}
        threads={threads}
        items={items}
        steps={steps ?? []}
        createThreadAction={createThread.bind(null, project.id)}
        updateThreadAction={updateThread.bind(null, project.id)}
        deleteThreadAction={deleteThread.bind(null, project.id)}
        addItemAction={addItemToThread.bind(null, project.id)}
        removeItemAction={removeItemFromThread.bind(null, project.id)}
        moveItemAction={moveThreadItem.bind(null, project.id)}
        updateNarrationAction={updateNarration.bind(null, project.id)}
      />
    </main>
  );
}
