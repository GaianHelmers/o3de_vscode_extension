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

const SERVER_NAME = "o3de";
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

/** The .mcp.json a client reads for `projectRoot`. */
export function mcpConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".mcp.json");
}

/** Set `mcpServers.o3de = entry` in <projectRoot>/.mcp.json, preserving everything else. */
export function writeMcpServerEntry(projectRoot: string, entry: unknown): void {
  const file = mcpConfigPath(projectRoot);
  const text = readExisting(file);
  if (text === undefined) {
    return; // existing file is unparseable — don't clobber it
  }
  const updated = applyEdits(text, modify(text, ["mcpServers", SERVER_NAME], entry, FORMAT));
  writeFile(file, updated.endsWith("\n") ? updated : `${updated}\n`);
  log().info(`LLM (MCP): wrote mcpServers.${SERVER_NAME} → ${file}`);
}

/** Remove `mcpServers.o3de` from <projectRoot>/.mcp.json (no-op if absent). */
export function removeMcpServerEntry(projectRoot: string): void {
  const file = mcpConfigPath(projectRoot);
  if (!fs.existsSync(file)) {
    return;
  }
  const text = readExisting(file);
  if (text === undefined) {
    return;
  }
  const updated = applyEdits(text, modify(text, ["mcpServers", SERVER_NAME], undefined, FORMAT));
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
