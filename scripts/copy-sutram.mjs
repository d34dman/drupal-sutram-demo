// Builds the sutram package and copies the build into web/libraries/sutram,
// where the Drupal library sutram/sutram loads it from. The copy is
// committed, so the demo runs without npm or GitHub, and the package can
// change without breaking the demo until the copy is refreshed.
//
//   npm run sutram:update                   builds ../sutram, the checkout next to this one
//   SUTRAM_SRC=<path> npm run sutram:update builds another checkout
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, process.env.SUTRAM_SRC || "../sutram");
const target = resolve(root, "web/libraries/sutram");

if (!existsSync(resolve(source, "scripts/build.mjs"))) {
  console.error(`sutram: no package with scripts/build.mjs at ${source}`);
  process.exit(1);
}
execFileSync(process.execPath, [resolve(source, "scripts/build.mjs")], { stdio: "inherit" });

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
copyFileSync(resolve(source, "dist/sutram.js"), resolve(target, "sutram.js"));

// Record which commit the build came from, so a change in the copy can be
// traced back to the package.
const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
let from = "unknown (not a git checkout)";
try {
  from = git("rev-parse", "HEAD") + (git("status", "--porcelain", "--", "src", "scripts") ? " plus uncommitted changes" : "");
} catch {}
writeFileSync(resolve(target, "SOURCE"), `Built from the sutram package (github.com/d34dman/sutram) by scripts/copy-sutram.mjs.\nCommit: ${from}\n`);
console.log(`sutram: copied the build of ${source} to web/libraries/sutram (${from})`);
