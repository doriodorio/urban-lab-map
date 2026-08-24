"use client";

import { useActionState, useState } from "react";

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

export function PublishControls({
  publicSlug,
  publishAction,
  unpublishAction,
}: {
  publicSlug: string | null;
  publishAction: () => Promise<ActionResult>;
  unpublishAction: () => Promise<ActionResult>;
}) {
  const [copied, setCopied] = useState(false);
  const path = publicSlug ? `/p/${publicSlug}` : null;

  // Composed on click rather than during render: the absolute URL depends on
  // window.location, which differs between server and client and would other-
  // wise mismatch on hydration.
  async function copyLink() {
    if (!path) return;
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!publicSlug) {
    return (
      <form
        action={async () => {
          await publishAction();
        }}
        className="flex flex-col gap-2"
      >
        <p className="text-sm text-neutral-600">
          Not published. Publishing creates a link that shows a read-only
          version of this map to anyone who has it — no account needed.
        </p>
        <button
          type="submit"
          className="self-start rounded bg-black px-3 py-1.5 text-sm font-medium text-white"
        >
          Publish
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-600">
        Published. Anyone with this link can read the map:
      </p>
      <code className="overflow-x-auto rounded bg-neutral-100 px-2 py-1.5 text-xs">
        {path}
      </code>
      <div className="flex items-center gap-4">
        <button
          onClick={copyLink}
          className="text-sm text-blue-600 underline"
        >
          {copied ? "Copied." : "Copy link"}
        </button>
        <a
          href={path ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-blue-600 underline"
        >
          Open
        </a>
        <form
          action={async () => {
            await unpublishAction();
          }}
          onSubmit={(e) => {
            if (
              !confirm(
                "Unpublish this map? The existing link stops working immediately. Publishing again creates a new link."
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <button type="submit" className="text-sm text-red-600 underline">
            Unpublish
          </button>
        </form>
      </div>
    </div>
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
