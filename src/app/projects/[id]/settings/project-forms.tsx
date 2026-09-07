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
  statement,
  coverImageUrl,
  docoUrl,
}: {
  action: BoundAction;
  name: string;
  description: string | null;
  statement: string | null;
  coverImageUrl: string | null;
  docoUrl: string | null;
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
          className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
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
          className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
        />
      </div>
      <div className="flex flex-col gap-3 border-t border-rule pt-3">
        <p className="label">The opening</p>
        <p className="text-[13px] text-ink-secondary">
          What a visitor meets before the map: a statement, a picture, and a
          one-minute film. Leave them empty and the published view opens
          straight onto the map.
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="statement" className="text-sm font-medium">
            Statement
          </label>
          <textarea
            id="statement"
            name="statement"
            defaultValue={statement ?? ""}
            rows={6}
            placeholder="Up to two paragraphs. Leave a blank line between them."
            className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="cover_image_url" className="text-sm font-medium">
            Opening image
          </label>
          <input
            id="cover_image_url"
            name="cover_image_url"
            type="url"
            defaultValue={coverImageUrl ?? ""}
            placeholder="https://…"
            className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <span className="text-[11px] text-ink-muted">
            Open the photograph in the map, hover it, and press &ldquo;Copy
            address&rdquo;. Or paste any public image URL.
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="doco_url" className="text-sm font-medium">
            One-minute film
          </label>
          <input
            id="doco_url"
            name="doco_url"
            type="url"
            defaultValue={docoUrl ?? ""}
            placeholder="https://youtube.com/watch?v=…"
            className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <span className="text-[11px] text-ink-muted">
            YouTube or Vimeo plays in place. Anything else becomes a link.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="press rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
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
          className="flex-1 rounded-md border border-rule bg-card px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
        />
        <button
          type="submit"
          disabled={pending}
          className="press rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
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
        className="text-xs text-ink-muted underline hover:text-red-600"
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
          className="self-start press rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white"
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

/**
 * Runs the file relocation and reports what happened.
 *
 * Safe to press twice: the action copies before it repoints and deletes only
 * after, so a second run finishes anything the first one left.
 */
export function RelocateMediaButton({
  action,
}: {
  action: () => Promise<{ error?: string; moved?: number; skipped?: number }>;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={running}
        onClick={async () => {
          setRunning(true);
          const outcome = await action();
          setRunning(false);
          setResult(
            outcome.error
              ? outcome.error
              : `Moved ${outcome.moved ?? 0} file${outcome.moved === 1 ? "" : "s"} into this project.`
          );
        }}
        className="press rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {running ? "Moving…" : "Move files into this project"}
      </button>
      {result && <span className="text-[13px] text-ink-secondary">{result}</span>}
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
        // No longer "cannot be undone" - saying so would be a lie, and would
        // make people hesitate over something that is now recoverable.
        if (
          !confirm(
            "Delete this project?\n\nIt stops being visible and its public link stops working. Any member can restore it from the workspace."
          )
        ) {
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
