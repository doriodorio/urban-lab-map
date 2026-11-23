#!/usr/bin/env node
/**
 * Take the whole archive off Supabase and put it in a folder.
 *
 * Two halves, because the project is two things:
 *
 *   media/       every file in the project-media bucket - the photographs,
 *                the recordings, the documents.
 *   database.sql a pg_dump of Postgres - the rows, and also the schema, the
 *                RLS policies and the functions that make the rows mean
 *                anything.
 *
 * The halves are deliberately separable, because the first one is the part
 * that cannot be replaced and the second one is the part that needs tools
 * installed. A database backup on its own restores an archive in which every
 * row is in place and every photograph is a broken link: the rows hold URLs,
 * and the files live somewhere else entirely. For a project whose whole
 * content is what a group found by walking around with a camera, that is the
 * loss that matters. So the media half runs with nothing but the keys already
 * in .env.local, and runs first.
 *
 * Nothing is ever deleted or overwritten. Each run writes a new dated folder,
 * so a backup taken today cannot damage the one taken last term - which is
 * the failure mode of most backup scripts, and the reason to say it out loud.
 *
 *   node scripts/backup.mjs
 *   node scripts/backup.mjs --out D:/archives
 *   node scripts/backup.mjs --db-url "postgresql://..."   (or SUPABASE_DB_URL)
 *
 * The database URL is never read from a file in the repository and never
 * written into the backup. It carries the database password.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BUCKET = "project-media";
/** Supabase caps a listing; ask for the most it will give per call. */
const PAGE = 1000;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

/**
 * The two public keys, read from .env.local rather than asked for.
 *
 * Both are already shipped to every browser that opens the app, so holding
 * them here adds no exposure. The anon key is all the media half needs: the
 * bucket is public to read, by the policy that lets a published map show its
 * photographs to a visitor with no account.
 */
async function readEnv(root) {
  const text = await fs.readFile(path.join(root, ".env.local"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      ".env.local is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  // SUPABASE_DB_URL may live here too. It carries the database password, so
  // .env.local - already ignored by git, and never shipped to a browser
  // because the name has no NEXT_PUBLIC_ prefix - is a better home for it
  // than a shell history or a command line.
  return { url: url.replace(/\/+$/, ""), key, dbUrl: env.SUPABASE_DB_URL ?? null };
}

/**
 * One page of a folder's contents.
 *
 * An entry with a null id is a folder rather than an object - that is the
 * only thing distinguishing them in this API, and getting it wrong means
 * either missing every file or trying to download directories.
 */
async function listPage({ url, key }, prefix, offset) {
  const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prefix,
      limit: PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Listing "${prefix}" failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Every object in the bucket, walking folders as they are found. */
async function listAll(creds) {
  const files = [];
  const queue = [""];

  while (queue.length) {
    const prefix = queue.shift();
    let offset = 0;

    for (;;) {
      const page = await listPage(creds, prefix, offset);
      for (const entry of page) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null) queue.push(full);
        else files.push({ path: full, size: entry.metadata?.size ?? null });
      }
      // A short page is the last page. Asking again would loop forever on a
      // folder whose contents are an exact multiple of the page size.
      if (page.length < PAGE) break;
      offset += PAGE;
    }
  }

  return files;
}

async function downloadFile({ url }, file, destination) {
  const res = await fetch(
    `${url}/storage/v1/object/public/${BUCKET}/${file.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`
  );
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const hash = createHash("sha256");
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => hash.update(chunk));
  await pipeline(body, createWriteStream(destination));

  const { size } = await fs.stat(destination);
  return { size, sha256: hash.digest("hex") };
}

/**
 * pg_dump, when it is installed.
 *
 * Not reimplemented in JavaScript, and not faked with a set of table reads.
 * A dump is the schema, the row-level security policies and the functions as
 * well as the rows, and a hand-rolled copy of "all the tables" would quietly
 * leave out the half that decides who may read what. If the tool is missing,
 * this half is skipped loudly rather than approximated.
 */
/**
 * Where pg_dump is, which on Windows is usually not on PATH.
 *
 * The EnterpriseDB installer leaves its bin directory out of PATH unless you
 * tick a box, so the tool is installed and invisible. Telling someone their
 * backup failed because of an environment variable, when the program is
 * sitting on their disk, is a worse answer than looking for it.
 */
async function findPgDump() {
  if (process.platform !== "win32") return "pg_dump";

  const roots = ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"];
  const found = [];
  for (const root of roots) {
    const versions = await fs.readdir(root).catch(() => []);
    for (const v of versions) {
      const exe = path.join(root, v, "bin", "pg_dump.exe");
      if (await fs.stat(exe).then(() => true).catch(() => false)) {
        found.push({ version: Number.parseInt(v, 10) || 0, exe });
      }
    }
  }

  // Newest first: a dump taken with an older pg_dump than the server can be
  // rejected outright, while a newer one reads an older server happily.
  found.sort((a, b) => b.version - a.version);
  return found[0]?.exe ?? "pg_dump";
}

async function dumpDatabase(dbUrl, destination) {
  const exe = await findPgDump();
  return new Promise((resolve) => {
    const child = spawn(
      exe,
      [dbUrl, "--no-owner", "--no-privileges", "--clean", "--if-exists", "-f", destination],
      { stdio: ["ignore", "inherit", "pipe"], shell: process.platform === "win32" }
    );

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", () =>
      resolve({ ok: false, reason: "pg_dump is not installed or not on PATH" })
    );
    child.on("close", (code) =>
      resolve(
        code === 0
          ? { ok: true }
          : { ok: false, reason: stderr.trim() || `pg_dump exited ${code}` }
      )
    );
  });
}

/**
 * Where this run should write: a new dated folder, or the unfinished one.
 *
 * The manifest is written last and only on completion, so a folder without
 * one is a run that was interrupted - the network dropped, the laptop slept,
 * someone pressed Ctrl+C at photograph 300 of 502. Continuing it is the whole
 * value of the resume check further down; starting a fresh folder instead
 * would download 429 MB again and leave a half-finished folder behind to be
 * mistaken for a backup later.
 *
 * A finished folder is never touched. Backups accumulate; they do not
 * overwrite each other.
 */
async function chooseDirectory(outRoot) {
  const entries = await fs.readdir(outRoot, { withFileTypes: true }).catch(() => []);
  const dated = entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(e.name))
    .map((e) => e.name)
    .sort();

  const newest = dated.at(-1);
  if (newest) {
    const finished = await fs
      .stat(path.join(outRoot, newest, "manifest.json"))
      .then(() => true)
      .catch(() => false);
    if (!finished) {
      return { dir: path.join(outRoot, newest), resumed: true };
    }
  }

  return { dir: path.join(outRoot, stamp()), resumed: false };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(
    d.getHours()
  )}${p(d.getMinutes())}`;
}

async function main() {
  const root = process.cwd();
  const creds = await readEnv(root);
  const outRoot = arg("out") ?? path.join(root, "backups");
  const dbUrl =
    arg("db-url") ?? process.env.SUPABASE_DB_URL ?? creds.dbUrl ?? null;
  const { dir, resumed } = await chooseDirectory(outRoot);

  await fs.mkdir(dir, { recursive: true });
  console.log(
    resumed
      ? `Continuing the unfinished backup in ${dir}\n`
      : `Backing up into ${dir}\n`
  );

  // --- the files, first and without conditions -----------------------------
  console.log("Listing the media bucket…");
  const files = await listAll(creds);
  const totalBytes = files.reduce((n, f) => n + (f.size ?? 0), 0);
  console.log(
    `  ${files.length} files, about ${(totalBytes / 1024 / 1024).toFixed(1)} MB\n`
  );

  const saved = [];
  const failed = [];
  let done = 0;

  for (const file of files) {
    const destination = path.join(dir, "media", ...file.path.split("/"));
    try {
      // Resume rather than restart. A run interrupted at photograph 300 of
      // 343 should not begin again at one.
      const existing = await fs.stat(destination).catch(() => null);
      if (existing && file.size !== null && existing.size === file.size) {
        saved.push({ ...file, skipped: true });
      } else {
        const result = await downloadFile(creds, file, destination);
        saved.push({ path: file.path, ...result });
      }
    } catch (e) {
      failed.push({ path: file.path, reason: String(e.message ?? e) });
    }
    done += 1;
    if (done % 25 === 0 || done === files.length) {
      process.stdout.write(`\r  saved ${done}/${files.length}`);
    }
  }
  console.log("\n");

  // --- the database, if the tools are here ---------------------------------
  let database = { ok: false, reason: "no database URL given" };
  if (dbUrl) {
    console.log("Dumping the database…");
    database = await dumpDatabase(dbUrl, path.join(dir, "database.sql"));
    console.log(database.ok ? "  done\n" : `  skipped: ${database.reason}\n`);
  }

  // --- what this folder actually contains ----------------------------------
  // Written last and read first. A backup nobody can check is a hope, and the
  // one moment anybody looks at a backup is the moment something has already
  // gone wrong.
  const manifest = {
    taken_at: new Date().toISOString(),
    supabase_url: creds.url,
    bucket: BUCKET,
    media: {
      listed: files.length,
      saved: saved.length,
      failed: failed.length,
      bytes: saved.reduce((n, f) => n + (f.size ?? 0), 0),
    },
    database,
    failures: failed,
    files: saved,
  };
  await fs.writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`Media:    ${saved.length} saved, ${failed.length} failed`);
  console.log(
    `Database: ${database.ok ? "database.sql written" : `NOT backed up — ${database.reason}`}`
  );
  if (failed.length) {
    console.log("\nThese files were not saved:");
    for (const f of failed.slice(0, 20)) console.log(`  ${f.path} — ${f.reason}`);
    if (failed.length > 20) console.log(`  …and ${failed.length - 20} more`);
  }
  console.log(`\n${path.join(dir, "manifest.json")}`);

  // A backup that half worked should not look like a success to whatever ran
  // it - a scheduled task, or a person reading one line of output.
  if (failed.length || !database.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`Backup failed: ${e.message ?? e}`);
  process.exitCode = 1;
});
