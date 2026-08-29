"use client";

import { useState } from "react";
import { useActionState } from "react";

type Thread = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};
type ThreadItem = {
  thread_id: string;
  item_id: string;
  order_index: number;
  narration: string | null;
};
type Item = {
  id: string;
  title: string | null;
  type: string;
  geometry: { type: string };
};

type ActionResult = { error?: string; success?: boolean };
type BoundAction = (
  prevState: ActionResult,
  formData: FormData
) => Promise<ActionResult>;

export function ThreadsManager({
  threads,
  items,
  steps,
  createThreadAction,
  updateThreadAction,
  deleteThreadAction,
  addItemAction,
  removeItemAction,
  moveItemAction,
  updateNarrationAction,
}: {
  projectId: string;
  threads: Thread[];
  items: Item[];
  steps: ThreadItem[];
  createThreadAction: BoundAction;
  updateThreadAction: (
    threadId: string,
    prevState: ActionResult,
    formData: FormData
  ) => Promise<ActionResult>;
  deleteThreadAction: (threadId: string) => Promise<ActionResult>;
  addItemAction: (
    threadId: string,
    itemId: string
  ) => Promise<ActionResult>;
  removeItemAction: (
    threadId: string,
    itemId: string
  ) => Promise<ActionResult>;
  moveItemAction: (
    threadId: string,
    itemId: string,
    direction: "up" | "down"
  ) => Promise<ActionResult>;
  updateNarrationAction: (
    threadId: string,
    itemId: string,
    narration: string
  ) => Promise<ActionResult>;
}) {
  const [openThreadId, setOpenThreadId] = useState<string | null>(
    threads[0]?.id ?? null
  );
  const [state, formAction, pending] = useActionState(createThreadAction, {});

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Threads
        </h2>

        {threads.length === 0 && (
          <p className="text-sm text-ink-muted">No threads yet.</p>
        )}

        <ul className="flex flex-col gap-2">
          {threads.map((thread) => (
            <li key={thread.id} className="rounded border border-rule">
              <button
                onClick={() =>
                  setOpenThreadId(openThreadId === thread.id ? null : thread.id)
                }
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
              >
                <span className="text-sm font-medium">{thread.name}</span>
                <span className="text-xs text-ink-muted">
                  {steps.filter((s) => s.thread_id === thread.id).length} steps
                  {openThreadId === thread.id ? " ▾" : " ▸"}
                </span>
              </button>

              {openThreadId === thread.id && (
                <ThreadEditor
                  thread={thread}
                  items={items}
                  steps={steps
                    .filter((s) => s.thread_id === thread.id)
                    .sort((a, b) => a.order_index - b.order_index)}
                  updateThreadAction={updateThreadAction.bind(null, thread.id)}
                  deleteThreadAction={deleteThreadAction}
                  addItemAction={addItemAction}
                  removeItemAction={removeItemAction}
                  moveItemAction={moveItemAction}
                  updateNarrationAction={updateNarrationAction}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3 border-t border-rule pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          New thread
        </h2>
        <form action={formAction} className="flex flex-col gap-2">
          <input
            type="text"
            name="name"
            required
            placeholder="e.g. The walk along the wadi"
            className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <textarea
            name="description"
            rows={2}
            placeholder="What does this tour show? (optional)"
            className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <button
            type="submit"
            disabled={pending}
            className="self-start press rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create thread"}
          </button>
          {state?.error && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}
        </form>
      </section>
    </div>
  );
}

function ThreadEditor({
  thread,
  items,
  steps,
  updateThreadAction,
  deleteThreadAction,
  addItemAction,
  removeItemAction,
  moveItemAction,
  updateNarrationAction,
}: {
  thread: Thread;
  items: Item[];
  steps: ThreadItem[];
  updateThreadAction: BoundAction;
  deleteThreadAction: (threadId: string) => Promise<ActionResult>;
  addItemAction: (threadId: string, itemId: string) => Promise<ActionResult>;
  removeItemAction: (threadId: string, itemId: string) => Promise<ActionResult>;
  moveItemAction: (
    threadId: string,
    itemId: string,
    direction: "up" | "down"
  ) => Promise<ActionResult>;
  updateNarrationAction: (
    threadId: string,
    itemId: string,
    narration: string
  ) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(updateThreadAction, {});
  const [addQuery, setAddQuery] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const inThread = new Set(steps.map((s) => s.item_id));
  const candidates = items.filter(
    (i) =>
      !inThread.has(i.id) &&
      (i.title ?? "").toLowerCase().includes(addQuery.toLowerCase())
  );

  const itemById = new Map(items.map((i) => [i.id, i]));

  return (
    <div className="flex flex-col gap-5 border-t border-rule p-3">
      <form action={formAction} className="flex flex-col gap-2">
        <input
          type="text"
          name="name"
          defaultValue={thread.name}
          required
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <textarea
          name="description"
          defaultValue={thread.description ?? ""}
          rows={2}
          placeholder="Description (optional)"
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
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

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Steps
        </h3>

        {steps.length === 0 && (
          <p className="text-sm text-ink-muted">
            No steps yet — add items below to build the tour.
          </p>
        )}

        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => {
            const item = itemById.get(step.item_id);
            return (
              <li
                key={step.item_id}
                className="flex flex-col gap-1 rounded border border-rule p-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">
                    {index + 1}. {item?.title || "Untitled"}
                  </span>
                  <div className="flex items-center gap-2">
                    <MoveButton
                      label="↑"
                      disabled={index === 0}
                      onMove={() =>
                        moveItemAction(thread.id, step.item_id, "up")
                      }
                    />
                    <MoveButton
                      label="↓"
                      disabled={index === steps.length - 1}
                      onMove={() =>
                        moveItemAction(thread.id, step.item_id, "down")
                      }
                    />
                    <form
                      action={async () => {
                        await removeItemAction(thread.id, step.item_id);
                      }}
                    >
                      <button
                        type="submit"
                        className="text-xs text-ink-muted underline hover:text-red-600"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
                <NarrationField
                  threadId={thread.id}
                  itemId={step.item_id}
                  narration={step.narration}
                  updateNarrationAction={updateNarrationAction}
                />
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Add a step
        </h3>
        <input
          type="search"
          value={addQuery}
          onChange={(e) => setAddQuery(e.target.value)}
          placeholder="Search items by title…"
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {items.length === inThread.size
              ? "Every item is already in this thread."
              : "No items match."}
          </p>
        ) : (
          <ul className="flex max-h-48 flex-col overflow-y-auto">
            {candidates.slice(0, 30).map((item) => (
              <li key={item.id}>
                <form
                  action={async () => {
                    const result = await addItemAction(thread.id, item.id);
                    setAddError(result.error ?? null);
                  }}
                >
                  <button
                    type="submit"
                    className="w-full truncate py-1 text-left text-sm text-blue-600 underline"
                  >
                    {item.title || "Untitled"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {addError && <p className="text-sm text-red-600">{addError}</p>}
      </div>

      <form
        action={async () => {
          await deleteThreadAction(thread.id);
        }}
        onSubmit={(e) => {
          if (
            !confirm(
              `Delete the thread "${thread.name}"? Its items stay on the map; only the tour is removed. This can't be undone.`
            )
          ) {
            e.preventDefault();
          }
        }}
        className="border-t border-rule pt-3"
      >
        <button type="submit" className="text-sm text-red-600 underline">
          Delete thread
        </button>
      </form>
    </div>
  );
}

function MoveButton({
  label,
  disabled,
  onMove,
}: {
  label: string;
  disabled: boolean;
  onMove: () => Promise<ActionResult>;
}) {
  return (
    <form
      action={async () => {
        await onMove();
      }}
    >
      <button
        type="submit"
        disabled={disabled}
        className="rounded border border-neutral-300 px-1.5 text-xs disabled:opacity-30"
      >
        {label}
      </button>
    </form>
  );
}

function NarrationField({
  threadId,
  itemId,
  narration,
  updateNarrationAction,
}: {
  threadId: string;
  itemId: string;
  narration: string | null;
  updateNarrationAction: (
    threadId: string,
    itemId: string,
    narration: string
  ) => Promise<ActionResult>;
}) {
  const [value, setValue] = useState(narration ?? "");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = value !== (narration ?? "");

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    await updateNarrationAction(threadId, itemId, value);
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        // Saves on blur for the common case, but blur alone would lose the
        // text if someone typed a paragraph and closed the tab - so unsaved
        // changes stay visible with an explicit way to commit them.
        onBlur={save}
        rows={2}
        placeholder="What should a reader be told at this stop?"
        className="rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <div className="flex items-center gap-3">
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="text-xs text-blue-600 underline disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save narration"}
          </button>
        )}
        {dirty && !saving && (
          <span className="text-xs text-amber-600">Unsaved</span>
        )}
        {saved && !dirty && (
          <span className="text-xs text-green-600">Saved.</span>
        )}
      </div>
    </div>
  );
}
