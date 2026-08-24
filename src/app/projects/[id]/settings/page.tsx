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
import {
  EditProjectForm,
  InviteMemberForm,
  RemoveMemberButton,
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

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, public_slug")
    .eq("id", id)
    .maybeSingle();

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
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <EditProjectForm
          action={updateProject.bind(null, project.id)}
          name={project.name}
          description={project.description}
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
                    <span className="text-neutral-400">({member.email})</span>
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

      <section className="border-t border-neutral-200 pt-6">
        <DeleteProjectButton action={deleteProject.bind(null, project.id)} />
      </section>
    </main>
  );
}
