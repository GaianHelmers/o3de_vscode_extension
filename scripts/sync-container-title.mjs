// ============================================================================
//  Sync the O3DE activity-bar container title with the package version.
//
//  The container title ("O3DE DEVELOPMENT TOOLS" at the top of the panel) is
//  static in package.json — there is no runtime API to change it. This runs at
//  package time (npm run vsix / vscode:prepublish) so the shipped title always
//  reads "O3DE Development Tools <version>", carried by the whole panel rather
//  than a single view header.
//
//  It edits ONLY the container title string (surgical text replace) so the rest
//  of package.json's formatting is left untouched.
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");

const text = readFileSync(pkgPath, "utf8");
const version = JSON.parse(text).version;
const wanted = `O3DE Development Tools ${version}`;

// Match only the activity-bar container's title (the object with "id": "o3de").
const re = /("id":\s*"o3de",\s*"title":\s*)"[^"]*"/;
if (!re.test(text)) {
  console.error('[sync-container-title] could not find the o3de container title in package.json');
  process.exit(1);
}

const updated = text.replace(re, `$1"${wanted}"`);
if (updated !== text) {
  writeFileSync(pkgPath, updated, "utf8");
  console.log(`[sync-container-title] set container title → "${wanted}"`);
} else {
  console.log(`[sync-container-title] container title already "${wanted}"`);
}
