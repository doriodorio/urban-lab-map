"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createProject } from "./actions";

const initialState: { error?: string } = {};

export default function NewProjectPage() {
  const [state, formAction, pending] = useActionState(
    async (_prevState: typeof initialState, formData: FormData) => {
      const result = await createProject(formData);
      return result ?? {};
    },
    initialState
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <Link href="/projects" className="text-sm text-ink-secondary underline">
          ← Workspace
        </Link>
        <h1 className="display mt-2 text-xl">New project</h1>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-ink-muted"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-ink-muted"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="press rounded-md bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create project"}
        </button>

        {state?.error && (
          <p className="text-sm text-red-600">{state.error}</p>
        )}
      </form>
    </main>
  );
}
