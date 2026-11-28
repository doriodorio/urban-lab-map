import Link from "next/link";
import { IconHome, IconSettings } from "@/components/icons";

/**
 * The bar at the top of a project, wherever you are inside one.
 *
 * Two tiers, because it answers two questions and used to answer both in a
 * single line of eight items at one weight: whose project this is, and which
 * way of reading it you are in. The top row is the identity, the row beneath
 * it is the four views, with the current one underlined.
 *
 * The two links that are not places - out to the workspace, and the project's
 * settings - are the only ones reduced to marks. A name is right for a
 * destination and wrong for a door.
 *
 * It is one component rather than a copy per page for a reason that is not
 * tidiness: a row of tabs that promises four places has to be present in all
 * four of them, or the promise is only true on the page you started from.
 *
 * Positioning is the caller's, through `className`. On the map and the board
 * it floats over a canvas as a card; on the pages that are documents it is a
 * rule across the top. The bar itself has no opinion about which.
 */
export type ProjectView = "field" | "map" | "board" | "threads" | "settings";

/**
 * Field first, though the map is where a project opens: it is the only one of
 * the four reached while standing in the street, and the other three are read
 * at a desk.
 *
 * Settings is not in this row. It is not another way of reading the archive -
 * it is the drawer the archive's own particulars are kept in - so it hangs off
 * the name above, behind the cog.
 */
const VIEWS: { id: ProjectView; label: string; path: string }[] = [
  { id: "field", label: "Field", path: "/field" },
  { id: "map", label: "Map", path: "" },
  { id: "board", label: "Board", path: "/board" },
  { id: "threads", label: "Threads", path: "/threads" },
];

/**
 * One of the four views.
 *
 * A transparent bottom border rather than none, so that the underline on the
 * current view adds no height and the four words sit on one line.
 */
const VIEW_TAB =
  "press rounded-sm border-b-2 border-transparent px-1.5 pb-0.5 text-[13px] text-ink-secondary hover:text-ink";

/** The view being read now: underlined, and not a link to itself. */
const VIEW_TAB_HERE =
  "border-b-2 border-ink px-1.5 pb-0.5 text-[13px] text-ink";

const MARK = "press rounded-lg p-1 text-ink-secondary hover:text-ink";

export function ProjectBar({
  project,
  view,
  className = "",
  children,
}: {
  project: { id: string; name: string };
  view: ProjectView;
  /** Where this bar sits, and what chrome it wears. */
  className?: string;
  /** Controls belonging to this view, at the far end of the top row. */
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col bg-card ${className}`}>
      <div className="flex items-center gap-3 px-3.5 py-2 max-md:gap-2 max-md:overflow-x-auto max-md:px-2.5 max-md:[&>*]:shrink-0">
        <Link
          href="/projects"
          title="Workspace"
          aria-label="Workspace"
          className={MARK}
        >
          <IconHome className="size-[18px]" />
        </Link>

        <span className="display max-w-[22ch] truncate whitespace-nowrap text-[15px] leading-tight">
          {project.name}
        </span>

        {/* A hairline, so the cog reads as belonging to the name beside it -
            this project's settings - rather than as a fifth view. */}
        <span aria-hidden className="h-4 w-px bg-ink/15" />

        {view === "settings" ? (
          <span aria-current="page" className="rounded-lg p-1 text-ink">
            <IconSettings className="size-[18px]" />
            <span className="sr-only">Settings</span>
          </span>
        ) : (
          <Link
            href={`/projects/${project.id}/settings`}
            title="Settings"
            aria-label="Settings"
            className={MARK}
          >
            <IconSettings className="size-[18px]" />
          </Link>
        )}

        {/* What this particular view can do, at the far end. Boxed controls,
            which is what separates them from the marks and the name: the
            grouping is in their shape, not in another hairline. */}
        {children && (
          <div className="ml-auto flex items-center gap-2 max-md:[&>*]:shrink-0">
            {children}
          </div>
        )}
      </div>

      {/* Words, not marks: these are places, and a place has a name. */}
      <nav
        aria-label="Views"
        className="flex items-center gap-1 border-t border-rule px-3 py-1.5 max-md:overflow-x-auto max-md:[&>*]:shrink-0"
      >
        {VIEWS.map((v) =>
          v.id === view ? (
            <span key={v.id} aria-current="page" className={VIEW_TAB_HERE}>
              {v.label}
            </span>
          ) : (
            <Link
              key={v.id}
              href={`/projects/${project.id}${v.path}`}
              className={VIEW_TAB}
            >
              {v.label}
            </Link>
          )
        )}
      </nav>
    </div>
  );
}
