"use client";

import { useActionState } from "react";

type ActionResult = { error?: string; success?: boolean };
type BoundAction = (
  prevState: ActionResult,
  formData: FormData
) => Promise<ActionResult>;

const initialState: ActionResult = {};

export function EditProjectForm({
  action,
  name,
  description,
}: {
  action: BoundAction;
  name: string;
  description: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          defaultValue={name}
          required
          className="rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={description ?? ""}
          rows={3}
          className="rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state?.success && (
          <span className="text-sm text-green-600">Saved.</span>
        )}
        {state?.error && (
          <span className="text-sm text-red-600">{state.error}</span>
        )}
      </div>
    </form>
  );
}

export function InviteMemberForm({ action }: { action: BoundAction }) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="email"
          name="email"
          required
          placeholder="teammate@bezalel.ac.il"
          className="flex-1 rounded border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function RemoveMemberButton({
  action,
}: {
  action: () => Promise<ActionResult>;
}) {
  return (
    <form
      action={async () => {
        await action();
      }}
    >
      <button
        type="submit"
        className="text-xs text-neutral-400 underline hover:text-red-600"
      >
        Remove
      </button>
    </form>
  );
}

export function DeleteProjectButton({
  action,
}: {
  action: () => Promise<ActionResult>;
}) {
  return (
    <form
      action={async () => {
        await action();
      }}
      onSubmit={(e) => {
        if (!confirm("Delete this project? This cannot be undone.")) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="text-sm text-red-600 underline"
      >
        Delete project
      </button>
    </form>
  );
}
