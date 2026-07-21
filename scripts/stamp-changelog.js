// ============================================================================
//  stamp-changelog.js - fill the changelog's release placeholder at publish time.
//
//  While developing, write the newest changelog section under a placeholder header:
//    ## [pending_version] - DATE
//  publish.bat calls this after deciding the version:
//    node scripts/stamp-changelog.js <version>
//  and it rewrites that header line to  ## [<version>] - <today>  (em-dash, ISO date).
//
//  No placeholder present (e.g. the section is already versioned) -> no-op, exit 0.
// ============================================================================

const fs = require("fs");
const path = require("path");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`stamp-changelog: expected a semver version argument, got "${version ?? ""}".`);
  process.exit(1);
}

const file = path.join(__dirname, "..", "changelog.md");
let text;
try {
  text = fs.readFileSync(file, "utf8");
} catch (err) {
  console.error(`stamp-changelog: cannot read ${file}: ${err.message}`);
  process.exit(1);
}

const PLACEHOLDER = "pending_version";
if (!text.includes(PLACEHOLDER)) {
  console.log(`stamp-changelog: no [${PLACEHOLDER}] placeholder found; leaving changelog unchanged.`);
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const header = `## [${version}] — ${today}`; // — = em-dash, matching existing entries

// Rewrite the whole placeholder header line (any date/text after it), else fall
// back to a plain token swap so a stray placeholder still gets a real version.
const rewritten = text.replace(/^##[ \t]*\[pending_version\].*$/m, header);
const out = rewritten !== text ? rewritten : text.split(PLACEHOLDER).join(version);

fs.writeFileSync(file, out, "utf8");
console.log(`stamp-changelog: set changelog release to [${version}] - ${today}.`);
