# Product Spec: A Map-Based Platform for Layered Research

**Author:** Dori Oryan
**Status:** Draft v2 — working document, first round of scope decisions made
**Date:** August 20, 2026 (last updated August 23, 2026)

---

## 1. Vision

This is a platform for building maps that hold research the way a research project actually accumulates it: not just coordinates and boundaries, but photographs, quotes, field recordings, interview transcripts, philosophical fragments, news clippings, and the connective tissue between them. The map is the interface, but the payload is qualitative and heterogeneous — closer to an annotated archive than a GIS layer stack.

The two reference points that shaped this spec pull in different directions, and the platform sits between them on purpose:

- **["Do Black Lives Matter in Beverly Hills?"](https://www.urbanhumanities.ucla.edu/do-black-lives-matter-in-beverly-hills)** (UCLA Urban Humanities) is a "thick map" — a single, richly layered research object combining a protest route, photographs from social media, news text, city legislative responses, and demographic data clustered around transit stops. It's built to make an argument, not to be a general tool. Every layer is chosen and curated for one story.
- **[Felt](https://felt.com)** is the opposite: a fast, general-purpose, cloud-native GIS platform. Drag in any file format, get instant geocoding and styling, collaborate in real time, embed anywhere. It's built to make maps *easy*, but its content model is spatial-data-first (points, boundaries, geometries, dashboards) — it isn't designed around long-form qualitative material as a first-class citizen.

**What this tool should be:** Felt's ease of creating and managing many maps over time, applied to Urban Humanities' content model — where a pin can hold a paragraph of philosophical reflection, an interview clip, and a photograph, and where a map is a curated research narrative rather than a data dashboard. Call this category "deep mapping" or "thick mapping" software.

---

## 2. Problem

Researchers working across humanities, urban studies, oral history, and cultural analysis routinely produce material that has a spatial dimension — an interview happened somewhere, a photograph was taken somewhere, an idea is *about* somewhere — but the tools available force a choice:

- General GIS tools (Felt, ArcGIS, QGIS) handle spatial data well but treat rich qualitative content as an afterthought (a popup with a text field, at best).
- Storytelling map tools (StoryMaps, Knight Lab StoryMap JS, the Urban Humanities approach) handle narrative and mixed media well but are typically built bespoke, per project, with no reusable workspace for managing many projects, revisiting old ones, or building a personal/institutional library of maps over time.
- Note-taking and archive tools (Notion, Airtable, Zotero) handle rich content and tagging well but have no real spatial reasoning — geography is, at best, a text field.

There's no tool built for a group of people who want to keep doing this kind of work — new groups, new topics, every semester or every project — where the map itself is a first-class shared research instrument from day one, rather than a one-off visualization stitched together by hand for a single final submission and then abandoned.

---

## 3. Target Users & Core Use Cases

**Primary user (v1): students in Bezalel Academy's Urban Lab track** — specifically, the cohort taking *Ideation Workshop 1: Human Research and Design Management* (סדנא רעיונית 1: מחקר אנוש וניהול עיצוב), a first-year, second-degree (master's) course. These are design management students, but "design" here spans a wide scope, and students arrive from all kinds of prior backgrounds and disciplines — the cohort is not a group of trained researchers or GIS users, so the tool has to be approachable to complete beginners in both mapping and formal research methods.

The course's own structure should drive the tool's design directly:

- Students work in small **groups**, each choosing its own research topic for the semester and running the same research arc in parallel — not one researcher building one map alone, but many groups building many maps at once, visible to each other and to the instructors.
- Each group's process moves through defined stages that map cleanly onto the content model in Section 5: an initial literature review mixing academic, professional, and non-academic materials; visual conceptualization (המשגה חזותית) used repeatedly as an analytical/mapping tool; field research (interviews, informal conversations, observations, visual documentation); building "theory from the field" (grounded theory) by putting field findings in dialogue with the literature; and converging all of it into a **"knowledge capsule"** — the course's own term for a consolidated body of theory, field data, and visual models that becomes the basis for the final academic paper and presentation.
- The course already leans on **Miro** as its central shared tool for this kind of work — the closest existing analogue to what this platform needs to do, except without any real geography or place-based organization. That's the gap this tool is meant to fill: the same kind of shared, visual, groupable knowledge-building Miro supports, but organized around the field sites and places the research is actually about.
- Instructors (currently Dr. Yona Weitz and Arch. Sharon Koniak) need access into each group's work to give feedback; with about six groups per cohort, being added to each group's Project directly is enough for v1 — no dedicated cross-group dashboard, and no built-in milestone/checkpoint tracking, are needed at this stage.

**Secondary users (later):** Dori and other independent researchers doing similar place-based, mixed-methods work outside a classroom context; other Bezalel courses or design-management cohorts in future years; the general public, if a finished student project is published for outside reading.

**Core use cases:**

1. *Run a semester-long group research project* — a group starts a project, moves through literature review, field research, and grounded-theory stages together, and converges everything into a knowledge capsule, with the map as the shared organizing surface for the whole process rather than a final output tacked on at the end.
2. *Build a thick map of a single research subject* — e.g., a place-based social issue, a community, a contested site — and attach photos, text, audio, and analysis to specific points, lines, or regions.
3. *Develop a theoretical or conceptual argument spatially* — attach theory fragments, key terms, and interpretive notes to places and to each other, and let the map reveal relationships between concept and geography that a written literature review alone wouldn't (this is the use case least served by existing tools, and the closest fit to the course's "visual conceptualization" method).
4. *Conduct and organize field research around place* — pin interview and observation locations, attach audio/video/transcript or field notes, tag by theme, and later filter/cluster by topic across a group's full set of field encounters.
5. *Give instructors visibility into a group's project* — for v1, with roughly six groups per cohort, this means an instructor simply being added to each group's Project directly (see Section 6); a dedicated cross-group dashboard is a phase-2 feature once that stops scaling.
6. *Publish a finished project for reading* — a clean, read-only, guided or free-roam viewing experience for the final submission, for classmates, instructors, or (eventually) readers outside the course.

---

## 4. Positioning at a Glance

| | Urban Humanities "thick map" | Felt | This tool |
|---|---|---|---|
| Built for | One research narrative | General spatial data / GIS | Many research narratives at once — a class cohort's worth of group projects, plus reuse over time |
| Content model | Rich, mixed media, curated by hand | Spatial datasets, files, geometries | Rich, mixed media, structured for reuse |
| Reusability | Bespoke per project | Fully reusable platform | Fully reusable platform |
| Primary content types | Photos, news text, demographic data, routes | Points/lines/polygons, tabular data, imagery layers | Images, long-form text, philosophical/conceptual notes, audio/video interviews, citations, plus basic spatial data |
| Authoring effort | High (custom build each time) | Low | Target: low |
| Reading experience | Narrative/guided | Dashboard/analytical | Narrative-first, with analytical/filter tools available |

---

## 5. Content & Data Model

This is the part existing tools don't get right for this use case, so it's worth specifying carefully.

**Workspace** → contains many **Projects** (maps). A researcher's whole body of work lives in one workspace; each research subject is its own project. This is what makes it a platform rather than a one-off (the Felt-like property). In the classroom context, a workspace maps naturally to one course cohort: each student group owns a Project inside it, group members co-edit their own Project, and instructors are added as a member of each group's Project individually — no blanket workspace-level access in v1 (Section 10).

**Project** → a single map, with:
- A base map (standard, minimal, satellite, or a custom/historical map image georeferenced to the area — useful for historical or conceptual work where a standard street map isn't the right base)
- One or more **Layers** (toggleable groups of items — e.g., "Interviews," "Press coverage," "Protest route," "Philosophical annotations"). Layers are fully custom per project — there's no fixed or global list of layer types; a group defines whatever layers fit its own topic, and can add new ones at any point if none of its existing layers is the right fit for a new item.
- A set of **Items** placed on the map
- Optional **Threads** — curated, ordered sequences of items that form a guided narrative (a "tour" through the map, similar in spirit to the Urban Humanities storytelling walk-through)

**Item** — the core unit of content, attached to a spatial anchor. Every item has:
- A **spatial anchor**: a point, a drawn line/route, or a drawn region/polygon (not every item needs to be a pin — a philosophical reflection might apply to an entire neighborhood, an interview might trace a walked route)
- A **type**, which determines what content it can hold:
  - *Image* — photo or scanned image, with caption and source/credit
  - *Text / note* — free-form long-form writing; this is where a "philosophical idea" lives — a reflection, an argument, a fragment, not forced into a short caption field
  - *Quote* — attributed text, distinct from a note, for citing a source, an interviewee, or a text
  - *Interview* — audio and/or video embed, plus transcript (full or excerpted), plus metadata (interviewee, date, interviewer)
  - *Document/citation* — a link or attached file (article, legislative record, PDF) with bibliographic metadata
  - *Data* — lightweight structured data (a number, a stat, a small table) for cases like the demographic figures in the Beverly Hills map
  - *Composite* — a single anchor holding a mix of the above (e.g., one pin with a photo, a quote, and a note together), since real research items are rarely just one type
- **Tags/themes** — freeform or from a project-level taxonomy, for cross-cutting filtering (e.g., tag every item touching "displacement" across a dozen different physical locations)
- **Time metadata** — a date or date range, optional but structured, enabling a timeline view and time-based filtering (when an interview happened, when a photo was taken, when an article was published)
- **Relationships** — an item can link to other items regardless of location (e.g., a philosophical note linking to three interviews it draws on) — this is what lets the "ideas" side of the tool have geography *and* its own internal logic, not just be scattered pins

**Why "Composite" and "relationships" matter most:** the single biggest gap in existing tools is that a pin is usually one thing (a marker, a photo, a data point). Real research items are naturally mixed (a photo *and* a quote *and* a note about why it matters) and naturally cross-referential (an idea that recurs across multiple places). The data model needs to support that from the start, or the tool will feel like a downgrade from a notebook.

---

## 6. Core Features

**MVP — what's needed for one group to build and publish one real thick map, inside a class cohort of many groups:**

- Map canvas with pan/zoom, base map selection, and support for a custom georeferenced image as a base layer
- Create/edit items: point, line, or region anchors; all item types above; rich text editor for notes; image and audio/video upload or embed (YouTube/Vimeo/SoundCloud links, plus direct file upload)
- Basic multi-author editing: every member of a group can add/edit items on their group's shared Project (this is not deferrable — the course is structured around group work from the start)
- Layer manager: create custom layers per project, assign items to layers, toggle visibility
- **Item-to-item linking**: link any item to any other item(s) regardless of location, and see an item's linked items from its detail panel. Confirmed as a core v1 feature, not a nice-to-have — it's the mechanism that lets a theoretical/philosophical idea have its own internal logic across the map rather than existing as scattered, disconnected pins.
- Tagging: apply tags to items, filter the map by tag
- Timeline: a scrubber or range filter that shows/hides items by date
- Thread/tour builder: order a subset of items into a guided sequence with per-step narration text, and a "play" mode that walks a reader through them
- Workspace dashboard: list of the Projects a user has access to. With only around six groups per cohort, v1 doesn't need dedicated cross-group tooling — instructors can simply be added as members of each group's Project directly, the same way a student would be
- Publish/share: a read-only public view of a finished map (link-based, no account needed to view), with the guided-tour mode as the default entry point and free exploration available too
- Basic search across item text, tags, and metadata within a project

**Phase 2 — once the MVP is validated:**

- Instructor/cross-group dashboard: a single view across all groups' Projects at once, useful once the cohort or number of courses using the tool grows beyond a size where "add the instructor to each project" stays convenient
- Finer-grained permissions and roles (e.g., instructor comments vs. edits, view-only guest links, per-group privacy from other groups)
- Relationship graph view: visualize how items/ideas connect across the map, independent of geography — a visualization layer on top of the linking that's already core to v1
- Interview transcript tools: auto-transcription, speaker labeling, click-to-jump from transcript to audio timestamp
- Citation export (BibTeX/Zotero-compatible) for academic use
- Crowdsourced/public contribution mode (readers can submit items for review, useful for participatory or oral-history projects)
- Comparison mode: view two time periods or two projects side by side
- Multi-language content support (relevant given a Hebrew-speaking, multilingual-materials cohort)
- Milestone/checkpoint tracking tied to the course's staged workflow — not needed for now; groups and instructors will manage their own process outside the tool

**Explicitly out of scope for now:** heavy GIS analysis (spatial joins, routing algorithms, raster analysis), enterprise features (SSO, compliance certifications), real-time multi-cursor editing.

---

## 7. Key Screens

- **Workspace dashboard** — grid/list of all projects, "new project" entry point
- **Map editor** — the main working view: map canvas, layer panel (left or right), item creation toolbar, item detail panel (opens on selecting/adding an item)
- **Item editor panel** — the rich content form: type selector, content fields (text/image/audio/etc.), tag input, date input, relationship linker
- **Thread/tour builder** — a sequential list view for ordering items into a guided narrative, separate from the free-form map view
- **Public viewer** — the read-only published version: guided-tour mode by default, with an option to drop into free exploration of the full map and its layers/filters
- **Timeline strip** — a persistent, collapsible control (in both editor and viewer) for date-based filtering

---

## 8. Technical Notes

The architecture is decided and specified in full in `CLAUDE.md` (stack, schema, screens, build order) — this section is the short rationale for those choices, kept here so the "why" travels with the rest of the product thinking.

**Map rendering:** MapLibre GL JS — open-source, supports custom base layers/georeferenced images, no vendor key required, given the need for a georeferenced custom base map (historical maps, non-standard base layers).

**Data storage:** Postgres, via Supabase — fits this content model better than a document store because of the relationship/linking requirement between items, and Supabase's built-in auth, Row Level Security, and file storage remove most of the infrastructure code an 8-week build would otherwise burn time on.

**Media storage:** Supabase Storage (S3-compatible) for images/audio/video.

**Why not a no-code tool (Felt, Knight Lab StoryMap JS, uMap, ArcGIS StoryMaps):** these were the right first move for pressure-testing the content model before any code existed, and they're still worth a quick hands-on look if the schema in the build brief needs sanity-checking against a real tool's behavior. But none of them support item-to-item linking — a confirmed must-have (Section 10) — so none of them can be v1 itself, only a prototyping aid.

---

## 9. Design Principles

- **The map is a container for arguments, not just data.** Curatorial choice (what's included, what's left out, how items are grouped into threads) is as important as accuracy — this follows the Urban Humanities model, not the neutral-dashboard model.
- **No content type is second-class.** A philosophical note shouldn't be a cramped popup field while a photo gets a full gallery treatment — both deserve real editing and display space.
- **Fast to start, easy to return to.** Following Felt's lead: creating a new project and getting a first item on the map should take under a minute, and a workspace of many past projects should feel like a library, not a graveyard of abandoned files.
- **Reading is a separate experience from authoring.** The guided-tour/public-viewer mode should feel like reading a piece of research, not like being handed an admin panel with the edit controls hidden.

---

## 10. Decisions (as of August 23, 2026)

- **Layers are fully custom, per project.** No fixed/global layer taxonomy — a group can define new layers whenever an existing one doesn't fit.
- **Item-to-item linking is a confirmed v1 feature**, not a phase-2 nice-to-have. The relationship graph *visualization* is still phase 2; the underlying ability to link items is not.
- **Publishing is link-based and public by default.** No private/institutional sharing gate needed for v1.
- **No cross-group dashboard in v1.** The course runs about six groups per cohort; instructors being added directly to each group's Project is sufficient. Revisit as a phase-2 feature if the tool scales beyond one small cohort.
- **No milestone/checkpoint tracking in the tool for now.** Groups and instructors manage the staged workflow (literature review → field → grounded theory → knowledge capsule) themselves, outside the tool.
- **Target launch: October 18, 2026** — the start of next semester, about eight weeks from this draft. No build has started yet.
- **Test data source:** last year's Urban Lab groups' material can be used to test the tool before the live semester start, rather than waiting on a current group's real-time data.

## 11. Open Questions

- **Build path — resolved.** Decided: a custom build, executed with Claude Code rather than a no-code/low-code stand-in. See `CLAUDE.md` — a companion, execution-ready spec (stack, schema, screens, week-by-week build order through October 18) written for Claude Code to build from directly.
- **Base map support.** Still unresolved: is a single custom base-map image (e.g., a historical map) enough for v1, or does the tool need full support for multiple custom base layers per project? The build brief currently assumes one base image per project — flag this to Claude Code early if that's wrong.
- **Data readiness.** Is last year's groups' material (interviews, images, field notes, literature reviews) already in a digital, importable form, or does it need to be gathered/digitized before it can be used as v1 test data? This matters for week 7 of the build brief's timeline.

---

## 12. Timeline & Next Steps

Build path is decided: a custom build, executed with Claude Code. The week-by-week schedule now lives in `CLAUDE.md` rather than here, so the build order has one home and doesn't drift out of sync between two documents. This PRD stays the source of truth for *why* — the vision, the users, the content model, and the decisions log above; the build brief is the source of truth for *how* and *by when*.

Immediate next step: hand `CLAUDE.md` to Claude Code and start week 1 (repo scaffold, Supabase schema, auth, deploy pipeline). In parallel, resolve the two open items in Section 11 (base map support, data readiness) — both have a concrete deadline inside the build brief's week 7 before they become blocking.
