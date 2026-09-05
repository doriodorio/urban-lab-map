"use client";

import { useState } from "react";

type ActionResult = { error?: string; success?: boolean };

/**
 * Deleted projects, and the way back from them.
 *
 * Renders nothing when the trash is empty, so it is invisible in normal use
 * and appears exactly when something has gone wrong.
 *
 * Restoring is open to any member: an accident should be undoable by whoever
 * had it, without waiting on a teacher. Permanent removal is the
 * administrator's alone, and is the only thing here that destroys work - so it
 * says what it will take with it, and asks.
 */
export function ProjectTrash({
  projects,
  isAdministrator,
  restoreAction,
  purgeAction,
}: {
  projects: { id: string; name: string; deletedAt: string }[];
  isAdministrator: boolean;
  restoreAction: (projectId: string) => Promise<ActionResult>;
  purgeAction: (projectId: string) => Promise<ActionResult>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (projects.length === 0) return null;

  return (
    <div className="flex flex-col">
      <p className="label border-b border-rule pb-2">
        Deleted &middot;{" "}
        {projects.length === 1 ? "1 project" : `${projects.length} projects`}
      </p>

      <ul className="flex flex-col divide-y divide-rule border-b border-rule">
        {projects.map((project) => (
          <li
            key={project.id}
            className="flex items-center gap-4 py-3 text-sm"
          >
            <span className="flex-1">
              <span className="block font-medium">{project.name}</span>
              <span className="label">
                Deleted {new Date(project.deletedAt).toLocaleDateString()}
              </span>
            </span>

            <button
              type="button"
              disabled={busy === project.id}
              onClick={async () => {
                setBusy(project.id);
                setError((await restoreAction(project.id)).error ?? null);
                setBusy(null);
              }}
              className="press rounded-md border border-rule bg-card px-3 py-1 text-[13px] disabled:opacity-40"
            >
              Restore
            </button>

            {isAdministrator && (
              <button
                type="button"
                disabled={busy === project.id}
                onClick={async () => {
                  if (
                    !confirm(
                      `Permanently delete "${project.name}"?\n\nThis removes every item, layer, link and thread in it, and the uploaded photographs and recordings with them. It cannot be undone, and nobody can restore it afterwards.\n\nGo ahead?`
                    )
                  ) {
                    return;
                  }
                  setBusy(project.id);
                  setError((await purgeAction(project.id)).error ?? null);
                  setBusy(null);
                }}
                className="press rounded-md px-2 py-1 text-[13px] text-ink-muted hover:text-red-600 disabled:opacity-40"
              >
                Delete for good
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="pt-2 text-sm text-red-600">{error}</p>}

      <p className="label pt-2">
        {isAdministrator
          ? "You see every group's deleted projects, and are the only one who can remove them for good."
          : "Kept until an administrator removes them."}
      </p>
    </div>
  );
}
