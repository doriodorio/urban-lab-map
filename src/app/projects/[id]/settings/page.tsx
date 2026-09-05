import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  updateProject,
  deleteProject,
  inviteMember,
  removeMember,
  publishProject,
  unpublishProject,
} from "../actions";
import { relocateProjectMedia } from "../map-actions";
import {
  EditProjectForm,
  InviteMemberForm,
  RemoveMemberButton,
  RelocateMediaButton,
  DeleteProjectButton,
  PublishControls,
} from "./project-forms";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, description, public_slug, statement, cover_image_url, doco_url")
    .eq("id", id)
    .maybeSingle();

  // Same reason as the editor page: a failed query is not a missing project,
  // and reporting it as one sends you looking for a deleted row when a
  // migration is what is actually missing.
  if (projectError) {
    throw new Error(
      `Couldn't load this project: ${projectError.message}. If this names a column, a migration in supabase/ still needs running.`
    );
  }

  if (!project) {
    notFound();
  }

  const { data: members } = (await supabase.rpc("get_project_members", {
    p_project_id: id,
  })) as {
    data:
      | {
          user_id: string;
          email: string;
          role: string;
          display_name: string | null;
        }[]
      | null;
  };

  // Files are stored as "{project_id}/{name}". A file under a different id
  // belongs to a project this item was moved out of - it still displays, but
  // it can only be deleted by a member of that other project.
  const { data: mediaItems } = await supabase
    .from("items")
    .select("media")
    .eq("project_id", id);

  const marker = "/storage/v1/object/public/project-media/";
  const strayFiles = (mediaItems ?? []).reduce((count, row) => {
    const media = (row.media ?? []) as { url: string }[];
    return (
      count +
      media.filter((m) => {
        const at = m.url?.indexOf(marker);
        if (at === undefined || at === -1) return false;
        return !m.url.slice(at + marker.length).startsWith(`${id}/`);
      }).length
    );
  }, 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <div className="flex items-center gap-4">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-neutral-500 underline"
        >
          ← Map
        </Link>
        <Link
          href={`/projects/${project.id}/threads`}
          className="text-sm text-neutral-500 underline"
        >
          Threads
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h1 className="display text-xl">{project.name}</h1>
        <EditProjectForm
          action={updateProject.bind(null, project.id)}
          name={project.name}
          description={project.description}
          statement={project.statement}
          coverImageUrl={project.cover_image_url}
          docoUrl={project.doco_url}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Publishing
        </h2>
        <PublishControls
          publicSlug={project.public_slug}
          publishAction={publishProject.bind(null, project.id)}
          unpublishAction={unpublishProject.bind(null, project.id)}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Members
        </h2>
        <ul className="flex flex-col gap-2">
          {members?.map((member) => (
            <li
              key={member.user_id}
              className="flex items-center justify-between text-sm"
            >
              <span>
                {member.display_name ? (
                  <>
                    {member.display_name}{" "}
                    <span className="text-ink-muted">({member.email})</span>
                  </>
                ) : (
                  member.email
                )}
                {member.role === "instructor" && (
                  <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                    instructor
                  </span>
                )}
              </span>
              {member.user_id !== user.id && (
                <RemoveMemberButton
                  action={removeMember.bind(null, project.id, member.user_id)}
                />
              )}
            </li>
          ))}
        </ul>
        <InviteMemberForm action={inviteMember.bind(null, project.id)} />
      </section>

      {strayFiles > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="label">Files</h2>
          <p className="text-[13px] text-ink-secondary">
            {strayFiles === 1
              ? "One file in this project is"
              : `${strayFiles} files in this project are`}{" "}
            still stored under another project&apos;s folder, from being moved
            here. They display normally, but they can only be deleted by
            someone who belongs to that other project &mdash; and if it is ever
            deleted, they can never be tidied up at all.
          </p>
          <RelocateMediaButton
            action={relocateProjectMedia.bind(null, project.id)}
          />
        </section>
      )}

      <section className="border-t border-rule pt-6">
        <DeleteProjectButton action={deleteProject.bind(null, project.id)} />
      </section>
    </main>
  );
}
