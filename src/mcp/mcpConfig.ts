// ============================================================================
//  MCP client config — write/merge the o3de server into a project's .mcp.json.
//
//  So a client (Claude Code) finds the endpoint with no copy-paste. We MERGE via
//  jsonc-parser (the same tolerant editor used for settings.json) — the file is
//  created if absent, any other mcpServers entries and the file's formatting are
//  preserved, and only our `o3de` key is set (or removed on disable). If the
//  existing file is unparseable we skip rather than clobber it.
// ============================================================================

import * as fs from "fs";
import * as path from "path";
import { modify, applyEdits, parse, ParseError } from "jsonc-parser";
import { log } from "../log";

// Uppercase so clients render the server as "O3DE" (not the title-cased "O3de"
// they derive from a lowercase key). LEGACY_NAME is the old lowercase key we
// migrate away from so we don't leave a duplicate entry behind.
export const SERVER_NAME = "O3DE";
const LEGACY_NAME = "o3de";
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

/** The .mcp.json a client reads for `projectRoot`. */
export function mcpConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".mcp.json");
}

/** True when <projectRoot>/.mcp.json declares our server entry (current or legacy key). */
export function hasMcpServerEntry(projectRoot: string): boolean {
  const file = mcpConfigPath(projectRoot);
  if (!fs.existsSync(file)) {
    return false;
  }
  try {
    const obj = parse(fs.readFileSync(file, "utf8")) as { mcpServers?: Record<string, unknown> } | undefined;
    const servers = obj?.mcpServers;
    if (!servers) {
      return false;
    }
    return [SERVER_NAME, LEGACY_NAME].some((key) => Object.prototype.hasOwnProperty.call(servers, key));
  } catch {
    return false;
  }
}

/** Set `mcpServers.O3DE = entry` in <projectRoot>/.mcp.json, preserving everything else. */
export function writeMcpServerEntry(projectRoot: string, entry: unknown): void {
  const file = mcpConfigPath(projectRoot);
  const text = readExisting(file);
  if (text === undefined) {
    return; // existing file is unparseable — don't clobber it
  }
  let updated = applyEdits(text, modify(text, ["mcpServers", SERVER_NAME], entry, FORMAT));
  updated = applyEdits(updated, modify(updated, ["mcpServers", LEGACY_NAME], undefined, FORMAT)); // drop legacy dup
  writeFile(file, updated.endsWith("\n") ? updated : `${updated}\n`);
  log().info(`LLM (MCP): wrote mcpServers.${SERVER_NAME} → ${file}`);
}

/** Remove our server entry (current + legacy keys) from <projectRoot>/.mcp.json. */
export function removeMcpServerEntry(projectRoot: string): void {
  const file = mcpConfigPath(projectRoot);
  if (!fs.existsSync(file)) {
    return;
  }
  const text = readExisting(file);
  if (text === undefined) {
    return;
  }
  let updated = applyEdits(text, modify(text, ["mcpServers", SERVER_NAME], undefined, FORMAT));
  updated = applyEdits(updated, modify(updated, ["mcpServers", LEGACY_NAME], undefined, FORMAT));
  writeFile(file, updated);
  log().info(`LLM (MCP): removed mcpServers.${SERVER_NAME} from ${file}`);
}

// ---- Internals -------------------------------------------------------------
/** Read the file's text ("{}" if absent), or undefined if it exists but won't parse. */
function readExisting(file: string): string | undefined {
  if (!fs.existsSync(file)) {
    return "{}";
  }
  try {
    const text = fs.readFileSync(file, "utf8");
    if (!text.trim()) {
      return "{}";
    }
    const errors: ParseError[] = [];
    parse(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
      log().warn(`LLM (MCP): ${file} is not valid JSON — leaving it untouched (edit .mcp.json yourself).`);
      return undefined;
    }
    return text;
  } catch (err) {
    log().warn(`LLM (MCP): could not read ${file}: ${String(err)}`);
    return undefined;
  }
}

function writeFile(file: string, text: string): void {
  try {
    fs.writeFileSync(file, text, "utf8");
  } catch (err) {
    log().warn(`LLM (MCP): could not write ${file}: ${String(err)}`);
  }
}
