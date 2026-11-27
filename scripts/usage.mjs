#!/usr/bin/env node
/**
 * How much of the storage allowance this project has actually used, and when
 * it runs out.
 *
 * The question that prompted this was "how do I know how much we've used",
 * and the dashboard answers it with one number. One number cannot be acted
 * on. Whether to compress uploads, upgrade the plan, or do nothing depends on
 * three things the dashboard does not say: how fast it is growing, what the
 * space is actually made of, and which group is using it.
 *
 * Read-only. It lists the bucket and reads item titles; it writes nothing and
 * deletes nothing.
 *
 *   node scripts/usage.mjs
 *   node scripts/usage.mjs --limit 2            (allowance in GB; default 1)
 *
 * The per-project names need the database, which needs psql and
 * SUPABASE_DB_URL in .env.local. Without either, the breakdown is by project
 * id - every other number is unaffected, because they all come from the
 * bucket listing, which the anon key can read.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const BUCKET = "project-media";
const PAGE = 1000;
const GB = 1024 ** 3;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
  return { url: url.replace(/\/+$/, ""), key, dbUrl: env.SUPABASE_DB_URL ?? null };
}

/**
 * Every object in the bucket, with its size and the day it arrived.
 *
 * The dates are the whole point: a total says where the project is, and only
 * the dates say how long it has.
 */
async function listAll({ url, key }) {
  const files = [];
  const queue = [""];

  while (queue.length) {
    const prefix = queue.shift();
    let offset = 0;

    for (;;) {
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
        throw new Error(`Listing failed: ${res.status} ${await res.text()}`);
      }
      const page = await res.json();
      for (const entry of page) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        // A null id is a folder, not an object. Getting this wrong means
        // either counting directories or missing every file under them.
        if (entry.id === null) queue.push(full);
        else {
          files.push({
            path: full,
            project: full.split("/")[0],
            size: entry.metadata?.size ?? 0,
            type: entry.metadata?.mimetype ?? "",
            created: entry.created_at ?? null,
          });
        }
      }
      if (page.length < PAGE) break;
      offset += PAGE;
    }
  }

  return files;
}

/** Where psql is, which on Windows the installer leaves off PATH. */
async function findPsql() {
  if (process.platform !== "win32") return "psql";
  const roots = ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"];
  const found = [];
  for (const root of roots) {
    for (const v of await fs.readdir(root).catch(() => [])) {
      const exe = path.join(root, v, "bin", "psql.exe");
      if (await fs.stat(exe).then(() => true).catch(() => false)) {
        found.push({ version: Number.parseInt(v, 10) || 0, exe });
      }
    }
  }
  found.sort((a, b) => b.version - a.version);
  return found[0]?.exe ?? null;
}

/**
 * Project names, if the database is reachable.
 *
 * Spawned without a shell: the path has a space in it and the connection
 * string carries the password, and neither should be composed into a command
 * line. A failure here is not an error - the report simply uses ids.
 */
async function projectNames(dbUrl) {
  if (!dbUrl) return new Map();
  const exe = await findPsql();
  if (!exe) return new Map();

  return new Promise((resolve) => {
    const child = spawn(
      exe,
      [dbUrl, "-At", "-F", "\t", "-c", "select id, name from projects where deleted_at is null"],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(new Map()));
    child.on("close", (code) => {
      if (code !== 0) return resolve(new Map());
      const names = new Map();
      for (const line of out.split(/\r?\n/)) {
        const [id, name] = line.split("\t");
        if (id && name) names.set(id, name);
      }
      resolve(names);
    });
  });
}

/**
 * When the allowance runs out, at the rate of the last four weeks.
 *
 * Deliberately the recent rate and not the average since the first upload:
 * the project sat empty for months before a semester started, and an average
 * that includes those months would promise years of headroom that the current
 * term will not honour.
 *
 * Null when nothing arrived recently - a straight line through no data is a
 * forecast of nothing.
 */
function runsOut(files, limitBytes, usedBytes) {
  const now = Date.now();
  const window = 28 * 24 * 60 * 60 * 1000;
  const recent = files.filter(
    (f) => f.created && now - Date.parse(f.created) <= window
  );
  const added = recent.reduce((n, f) => n + f.size, 0);
  if (added === 0) return null;

  const perDay = added / 28;
  const left = limitBytes - usedBytes;
  const days = Math.max(0, Math.round(left / perDay));
  return {
    perDay,
    perWeek: perDay * 7,
    days,
    on: new Date(now + days * 24 * 60 * 60 * 1000),
  };
}

function bar(fraction, width = 32) {
  const filled = Math.min(width, Math.round(fraction * width));
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`;
}

async function main() {
  const root = process.cwd();
  const creds = await readEnv(root);
  const limitBytes = Number(arg("limit") ?? 1) * GB;

  console.log("Listing the media bucket…\n");
  const files = await listAll(creds);
  const used = files.reduce((n, f) => n + f.size, 0);

  console.log(`Storage  ${bar(used / limitBytes)}  ${mb(used)} of ${mb(limitBytes)}`);
  console.log(
    `         ${files.length} files, ${Math.round((used / limitBytes) * 100)}% of the allowance used\n`
  );

  const forecast = runsOut(files, limitBytes, used);
  if (forecast) {
    console.log(
      `Growing by about ${mb(forecast.perWeek)} a week (last four weeks).`
    );
    console.log(
      forecast.days > 0
        ? `At that rate the allowance runs out in ${forecast.days} days, around ${forecast.on.toISOString().slice(0, 10)}.\n`
        : `The allowance is already gone.\n`
    );
  } else {
    console.log("Nothing uploaded in the last four weeks, so no rate to project from.\n");
  }

  // What the space is made of. The answer decides whether compressing
  // uploads is worth building: it only is if images dominate.
  const byType = new Map();
  for (const f of files) {
    const kind = (f.type || "other").split("/")[0];
    const row = byType.get(kind) ?? { count: 0, bytes: 0 };
    row.count += 1;
    row.bytes += f.size;
    byType.set(kind, row);
  }
  console.log("By kind");
  for (const [kind, row] of [...byType].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(
      `  ${kind.padEnd(10)} ${String(row.count).padStart(5)} files  ${mb(row.bytes).padStart(10)}  avg ${mb(row.bytes / row.count)}`
    );
  }
  console.log("");

  const names = await projectNames(creds.dbUrl);
  const byProject = new Map();
  for (const f of files) {
    const row = byProject.get(f.project) ?? { count: 0, bytes: 0 };
    row.count += 1;
    row.bytes += f.size;
    byProject.set(f.project, row);
  }
  console.log(names.size ? "By project" : "By project (ids only - no database connection)");
  for (const [id, row] of [...byProject].sort((a, b) => b[1].bytes - a[1].bytes)) {
    const label = names.get(id) ?? id;
    console.log(
      `  ${String(label).slice(0, 28).padEnd(30)} ${String(row.count).padStart(5)} files  ${mb(row.bytes).padStart(10)}`
    );
  }
  console.log("");

  const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 8);
  console.log("Largest files");
  for (const f of biggest) {
    console.log(`  ${mb(f.size).padStart(10)}  ${f.type || "?"}  ${f.path.split("/").pop()}`);
  }
}

main().catch((e) => {
  console.error(`Could not read usage: ${e.message ?? e}`);
  process.exitCode = 1;
});
