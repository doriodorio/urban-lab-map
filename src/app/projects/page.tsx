import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut, updateDisplayName } from "./actions";
import { DisplayNameForm } from "./display-name-form";

/** 09.2026 - the stamp a catalog entry carries, not a full date. */
function stamp(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: projects, error }, { data: profile }, { data: itemRows }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, description, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle(),
      // Counts and last-touched dates for the index. RLS already limits this to
      // the projects this person belongs to, so it needs no filter of its own.
      supabase.from("items").select("project_id, updated_at").is("deleted_at", null),
    ]);

  const counts = new Map<string, number>();
  const touched = new Map<string, string>();
  for (const row of itemRows ?? []) {
    const id = row.project_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const at = row.updated_at as string | null;
    if (at && (!touched.get(id) || at > touched.get(id)!)) touched.set(id, at);
  }
  const total = itemRows?.length ?? 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="display text-xl">Workspace</h1>
        <form action={signOut}>
          <button className="label hover:text-ink">Sign out</button>
        </form>
      </div>

      <div className="flex items-center justify-between border-t border-rule pt-4">
        <p className="text-sm text-ink-secondary">Signed in as {user.email}</p>
        <Link
          href="/projects/new"
          className="press rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white"
        >
          New project
        </Link>
      </div>

      <div className="flex flex-col gap-1 rounded-md border border-rule bg-card p-3">
        <label className="label">Display name</label>
        <DisplayNameForm
          action={updateDisplayName}
          displayName={profile?.display_name ?? null}
          email={user.email ?? ""}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600">
          Couldn&apos;t load projects: {error.message}
        </p>
      )}

      {projects && projects.length === 0 && (
        <p className="text-sm text-ink-muted">
          No projects yet. Create one to get started.
        </p>
      )}

      {projects && projects.length > 0 && (
        <div className="flex flex-col">
          <p className="label border-b border-rule pb-2">00 &middot; Projects</p>

          <ul className="flex flex-col divide-y divide-rule border-b border-rule">
            {projects.map((project, index) => {
              const count = counts.get(project.id) ?? 0;
              const updated = stamp(touched.get(project.id) ?? null);
              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex items-baseline gap-4 py-3.5 hover:bg-neutral-900/[0.03]"
                  >
                    <span className="flex-1">
                      <span className="block text-sm font-medium">
                        {project.name}
                      </span>
                      {project.description && (
                        <span className="block text-sm text-ink-secondary">
                          {project.description}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                      <span className="code tabular-nums">
                        PRJ&middot;{String(index + 1).padStart(3, "0")}
                      </span>
                      <span className="label">
                        {count === 1 ? "1 item" : `${count} items`}
                        {updated ? ` · ${updated}` : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <p className="label pt-2">
            {projects.length === 1 ? "1 project" : `${projects.length} projects`}{" "}
            &middot; {total === 1 ? "1 item" : `${total} items`} in the catalog
          </p>
        </div>
      )}
    </main>
  );
}
