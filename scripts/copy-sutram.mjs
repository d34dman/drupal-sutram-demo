// Copies the sutram package into web/libraries/sutram, where the Drupal
// library sutram/sutram loads it from.
//
//   npm install                 copies node_modules/sutram (from GitHub)
//   npm run sutram:local        copies ../sutram, a checkout next to this one
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, process.env.SUTRAM_SRC || "node_modules/sutram");
const target = resolve(root, "web/libraries/sutram");

if (!existsSync(resolve(source, "src/browser.js"))) {
  console.error(`sutram: no package at ${source}`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
for (const part of ["src", "package.json", "README.md"]) {
  cpSync(resolve(source, part), resolve(target, part), { recursive: true });
}
console.log(`sutram: copied ${source} to web/libraries/sutram`);
