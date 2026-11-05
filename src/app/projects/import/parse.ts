/**
 * Turning a spreadsheet of groups into projects.
 *
 * The file a course actually produces is not the file a parser would ask for.
 * It arrives transposed as often as not - fields down the left, one column per
 * group - because that is the shape a person fills in when the groups are the
 * thing being listed. It carries a stray row with no label at all, where
 * somebody added a fifth address to one group. Columns are headed email1..4
 * whether or not every group has four.
 *
 * So the rules here are deliberately forgiving: find the name row, find the
 * description row, and treat every other cell in the column as an address if
 * it looks like one. That handles the unlabelled row without a special case,
 * and it does not care how many email columns there are.
 */

export type ParsedProject = {
  name: string;
  description: string | null;
  emails: string[];
  /** Cells that sat in an email position but are not addresses. */
  rejected: string[];
};

export type ParseResult = {
  projects: ParsedProject[];
  /** Transposed means fields ran down the left rather than across the top. */
  transposed: boolean;
  /** Addresses in every project - almost always the instructor. */
  inEveryProject: string[];
};

// Deliberately loose. The authority on whether an address exists is the
// mailbox, not a regular expression, and an over-strict pattern here would
// reject a real student on the morning of the first class.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNameLabel(cell: string) {
  return /^name$/i.test(cell.trim());
}

function isDescriptionLabel(cell: string) {
  return /^desc(ription)?$/i.test(cell.trim());
}

/** How much a row or column looks like a strip of field labels. */
function labelScore(cells: string[]) {
  return cells.filter(
    (c) => isNameLabel(c) || isDescriptionLabel(c) || /^e-?mail/i.test(c.trim())
  ).length;
}

export function parseTable(text: string): ParseResult {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { projects: [], transposed: false, inEveryProject: [] };
  }

  // Tabs win when present: a description can legitimately contain a comma,
  // and pasting from a spreadsheet gives tabs.
  const delimiter = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  const grid = lines.map((line) => line.split(delimiter).map((c) => c.trim()));
  const width = Math.max(...grid.map((r) => r.length));
  for (const row of grid) {
    while (row.length < width) row.push("");
  }

  const firstColumn = grid.map((r) => r[0]);
  const transposed = labelScore(firstColumn) >= labelScore(grid[0]);

  const projects: ParsedProject[] = [];

  if (transposed) {
    const nameRow = grid.find((r) => isNameLabel(r[0]));
    const descriptionRow = grid.find((r) => isDescriptionLabel(r[0]));
    if (!nameRow) return { projects: [], transposed, inEveryProject: [] };

    for (let c = 1; c < width; c++) {
      const name = nameRow[c];
      if (!name) continue;
      const emailCells = grid
        .filter((r) => r !== nameRow && r !== descriptionRow)
        .map((r) => r[c]);
      projects.push(
        buildProject(name, descriptionRow ? descriptionRow[c] : "", emailCells)
      );
    }
  } else {
    const header = grid[0];
    const nameAt = header.findIndex(isNameLabel);
    const descriptionAt = header.findIndex(isDescriptionLabel);
    if (nameAt === -1) return { projects: [], transposed, inEveryProject: [] };

    for (const row of grid.slice(1)) {
      const name = row[nameAt];
      if (!name) continue;
      const emailCells = row.filter(
        (_, i) => i !== nameAt && i !== descriptionAt
      );
      projects.push(
        buildProject(
          name,
          descriptionAt === -1 ? "" : row[descriptionAt],
          emailCells
        )
      );
    }
  }

  // An address in every single group is the person running the course, not a
  // student in four groups at once. Offered as a suggestion, never applied on
  // its own - with one project in the file, every address qualifies, which is
  // why this needs at least two.
  const inEveryProject =
    projects.length > 1
      ? projects[0].emails.filter((email) =>
          projects.every((p) => p.emails.includes(email))
        )
      : [];

  return { projects, transposed, inEveryProject };
}

function buildProject(
  name: string,
  description: string,
  cells: string[]
): ParsedProject {
  const emails: string[] = [];
  const rejected: string[] = [];

  for (const raw of cells) {
    const cell = raw.trim();
    if (!cell) continue;
    // Addresses are compared and stored folded. A real list mixes SHOUTED
    // addresses in with lowercase ones, and the invitation's primary key is
    // (project_id, email) - unfolded, one person keys two invitations.
    const email = cell.toLowerCase();
    if (!LOOKS_LIKE_EMAIL.test(email)) {
      rejected.push(cell);
      continue;
    }
    if (!emails.includes(email)) emails.push(email);
  }

  return {
    name: name.trim(),
    description: description.trim() || null,
    emails,
    rejected,
  };
}
