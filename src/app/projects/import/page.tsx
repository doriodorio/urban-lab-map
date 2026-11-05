import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ImportForm } from "./import-form";

export default async function ImportProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Only to warn about a name that already exists, which is what a second run
  // of the same file looks like.
  const { data: projects } = await supabase.from("projects").select("name");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <div>
        <Link href="/projects" className="text-sm text-ink-muted underline">
          ← Workspace
        </Link>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="display text-xl">Import a semester</h1>
        <p className="max-w-[60ch] text-sm text-ink-secondary">
          One project per group, with everyone in it invited at once. Whatever
          you call the projects here, each group can rename itself and write
          its own description in Settings afterwards.
        </p>
      </header>

      <ImportForm existingNames={(projects ?? []).map((p) => p.name)} />
    </main>
  );
}
