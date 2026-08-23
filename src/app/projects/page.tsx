import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workspace</h1>
        <form action={signOut}>
          <button className="text-sm text-neutral-500 underline">
            Sign out
          </button>
        </form>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600">Signed in as {user.email}</p>
        <Link
          href="/projects/new"
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white"
        >
          New project
        </Link>
      </div>

      {error && (
        <p className="text-sm text-red-600">
          Couldn&apos;t load projects: {error.message}
        </p>
      )}

      {projects && projects.length === 0 && (
        <p className="text-sm text-neutral-400">
          No projects yet. Create one to get started.
        </p>
      )}

      <ul className="flex flex-col divide-y divide-neutral-200 border-y border-neutral-200">
        {projects?.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}`}
              className="flex flex-col gap-0.5 py-3 hover:bg-neutral-50"
            >
              <span className="text-sm font-medium">{project.name}</span>
              {project.description && (
                <span className="text-sm text-neutral-500">
                  {project.description}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
