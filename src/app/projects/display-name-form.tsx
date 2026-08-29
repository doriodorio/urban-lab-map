"use client";

import { useActionState } from "react";

type ActionResult = { error?: string; success?: boolean };

export function DisplayNameForm({
  action,
  displayName,
  email,
}: {
  action: (
    prevState: ActionResult,
    formData: FormData
  ) => Promise<ActionResult>;
  displayName: string | null;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          name="display_name"
          defaultValue={displayName ?? ""}
          maxLength={40}
          placeholder={email.split("@")[0]}
          className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="press rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        Shown instead of your email next to items you add. Leave empty to go
        back to using your email.
      </p>
      {state?.success && (
        <p className="text-xs text-green-600">Saved.</p>
      )}
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
