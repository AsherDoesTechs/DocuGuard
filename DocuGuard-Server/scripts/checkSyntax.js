#!/usr/bin/env node
/**
 * Parses every backend source file so a syntax error cannot reach a deploy.
 *
 * `node app.js` only parses the files it happens to require at boot, and the
 * cron jobs, controllers and utils that are not on that path were never checked
 * at all. That is how a malformed edit could sit in a controller until the
 * route was first hit in production.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SERVER_ROOT = path.resolve(__dirname, "..");
const SHARED_ROOT = path.resolve(SERVER_ROOT, "..", "shared");

const SEARCH_ROOTS = [SERVER_ROOT, SHARED_ROOT];
const IGNORED_DIRS = new Set(["node_modules", ".git", "coverage", "dist", ".expo"]);

function collectJsFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectJsFiles(path.join(dir, entry.name), found);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

const files = SEARCH_ROOTS.filter((root) => fs.existsSync(root)).flatMap((root) =>
  collectJsFiles(root),
);

const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failures.push({ file, output: (error.stderr || error.stdout || "").toString() });
  }
}

if (failures.length > 0) {
  for (const { file, output } of failures) {
    console.error(`\nSYNTAX ERROR: ${path.relative(SERVER_ROOT, file)}`);
    console.error(output.trim());
  }
  console.error(`\n${failures.length} of ${files.length} file(s) failed to parse.`);
  process.exit(1);
}

console.log(`Parsed ${files.length} JavaScript file(s) successfully.`);