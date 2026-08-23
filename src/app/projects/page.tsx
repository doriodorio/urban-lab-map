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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workspace</h1>
        <form action={signOut}>
          <button className="text-sm text-neutral-500 underline">
            Sign out
          </button>
        </form>
      </div>
      <p className="text-sm text-neutral-600">
        Hello, {user.email}. Auth + deploy pipeline is working end to end.
      </p>
      <p className="text-sm text-neutral-400">
        Project CRUD lands in Week 2.
      </p>
    </main>
  );
}
