"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { parseTable } from "./parse";
import { importProjects, type ImportOutcome } from "./actions";

export function ImportForm({ existingNames }: { existingNames: string[] }) {
  const [text, setText] = useState("");
  const [instructors, setInstructors] = useState("");
  const [touchedInstructors, setTouchedInstructors] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<ImportOutcome[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const parsed = useMemo(() => parseTable(text), [text]);

  // The suggestion fills the box until the moment it is edited, after which it
  // stops moving under the person's hands.
  const instructorValue = touchedInstructors
    ? instructors
    : parsed.inEveryProject.join(", ");

  const instructorSet = useMemo(
    () =>
      new Set(
        instructorValue
          .split(/[,;\s]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      ),
    [instructorValue]
  );

  const taken = useMemo(
    () => new Set(existingNames.map((n) => n.toLowerCase())),
    [existingNames]
  );

  async function run() {
    setRunning(true);
    setFailure(null);
    const result = await importProjects(
      parsed.projects.map((p) => ({
        name: p.name,
        description: p.description,
        members: p.emails.map((email) => ({
          email,
          role: instructorSet.has(email)
            ? ("instructor" as const)
            : ("member" as const),
        })),
      }))
    );
    setRunning(false);
    if (result.error) {
      setFailure(result.error);
      return;
    }
    setOutcomes(result.outcomes);
  }

  if (outcomes) {
    return <Results outcomes={outcomes} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="display text-lg">The file</h2>
          <p className="text-sm text-ink-secondary">
            Choose a .tsv or .csv file, or paste straight from a spreadsheet.
            Fields can run across the top or down the left — both are read.
          </p>
        </div>

        <input
          type="file"
          accept=".tsv,.csv,.txt,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setText(await file.text());
          }}
          className="text-sm text-ink-secondary file:mr-3 file:rounded-md file:border file:border-rule file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          dir="auto"
          placeholder={"name\tgroup1\tgroup2\ndescription\t…\t…\nemail1\ta@x.com\tb@x.com"}
          className="rounded-md border border-rule bg-card px-3 py-2 font-mono text-[12px] outline-none focus:border-ink-muted"
        />
      </section>

      {parsed.projects.length > 0 && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="display text-lg">Instructors</h2>
            <p className="text-sm text-ink-secondary">
              Anyone listed here joins every project they appear in as an
              instructor rather than a member. Both can edit everything — the
              role is a label on the member list.
            </p>
            <input
              value={instructorValue}
              onChange={(e) => {
                setTouchedInstructors(true);
                setInstructors(e.target.value);
              }}
              placeholder="nobody@example.com"
              className="rounded-md border border-rule bg-card px-3 py-2 text-sm outline-none focus:border-ink-muted"
            />
            {!touchedInstructors && parsed.inEveryProject.length > 0 && (
              <p className="text-[13px] text-ink-secondary">
                Filled in because this address is in every group in the file.
                Clear it if that is wrong.
              </p>
            )}
          </section>

          <Preview
            projects={parsed.projects}
            instructorSet={instructorSet}
            taken={taken}
            transposed={parsed.transposed}
          />

          <div className="flex flex-col gap-3 border-t border-rule pt-5">
            {failure && <p className="text-sm text-red-700">{failure}</p>}
            <button
              type="button"
              disabled={running}
              onClick={run}
              className="press self-start rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {running
                ? "Creating…"
                : `Create ${parsed.projects.length} project${parsed.projects.length === 1 ? "" : "s"}`}
            </button>
            <p className="text-[13px] text-ink-secondary">
              Nothing is emailed. Send the groups the address of the site
              yourself — each person joins the moment they first sign in.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Preview({
  projects,
  instructorSet,
  taken,
  transposed,
}: {
  projects: ReturnType<typeof parseTable>["projects"];
  instructorSet: Set<string>;
  taken: Set<string>;
  transposed: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="display text-lg">
          {projects.length} project{projects.length === 1 ? "" : "s"} to create
        </h2>
        <p className="text-[13px] text-ink-secondary">
          Read {transposed ? "down the left" : "across the top"}. Check it
          before creating — nothing has happened yet.
        </p>
      </div>

      <div className="flex flex-col border-t border-rule">
        {projects.map((p) => {
          const clash = taken.has(p.name.toLowerCase());
          return (
            <div
              key={p.name}
              className="flex flex-col gap-1.5 border-b border-rule py-3"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span dir="auto" className="text-[15px] font-medium text-ink">
                  {p.name}
                </span>
                <span className="font-mono text-[11px] tracking-wider text-ink-muted">
                  {p.emails.length} {p.emails.length === 1 ? "person" : "people"}
                </span>
              </div>

              {p.description && (
                <p dir="auto" className="text-[13px] text-ink-secondary">
                  {p.description}
                </p>
              )}

              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {p.emails.map((email) => (
                  <li key={email} className="text-[12px] text-ink-secondary">
                    {email}
                    {instructorSet.has(email) && (
                      <span className="ml-1 text-ink-muted">(instructor)</span>
                    )}
                  </li>
                ))}
              </ul>

              {clash && (
                <p className="text-[13px] text-red-700">
                  You are already in a project called {p.name}. Creating this
                  makes a second one with the same name.
                </p>
              )}
              {p.rejected.length > 0 && (
                <p className="text-[13px] text-red-700">
                  Not an address, so it will be skipped:{" "}
                  {p.rejected.join(", ")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Results({ outcomes }: { outcomes: ImportOutcome[] }) {
  const made = outcomes.filter((o) => o.projectId);
  const failed = outcomes.filter((o) => !o.projectId);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="display text-lg">
        {made.length} project{made.length === 1 ? "" : "s"} created
      </h2>

      <div className="flex flex-col border-t border-rule">
        {outcomes.map((o) => (
          <div
            key={o.name}
            className="flex flex-col gap-1 border-b border-rule py-3"
          >
            <div className="flex items-baseline justify-between gap-4">
              {o.projectId ? (
                <Link
                  href={`/projects/${o.projectId}`}
                  dir="auto"
                  className="text-[15px] font-medium text-ink underline"
                >
                  {o.name}
                </Link>
              ) : (
                <span dir="auto" className="text-[15px] font-medium text-ink">
                  {o.name}
                </span>
              )}
              {o.projectId && (
                <span className="font-mono text-[11px] tracking-wider text-ink-muted">
                  {o.invited} invited
                  {o.addedDirectly > 0 && `, ${o.addedDirectly} added`}
                </span>
              )}
            </div>
            {o.error && <p className="text-[13px] text-red-700">{o.error}</p>}
            {o.memberErrors.map((m) => (
              <p key={m} className="text-[13px] text-red-700">
                {m}
              </p>
            ))}
          </div>
        ))}
      </div>

      {failed.length === 0 && (
        <p className="text-sm text-ink-secondary">
          Send the groups{" "}
          <span className="font-medium text-ink">the address of the site</span>.
          Each person joins their project the first time they sign in with the
          address you listed.
        </p>
      )}

      <Link href="/projects" className="text-sm text-ink underline">
        Back to the workspace
      </Link>
    </section>
  );
}
