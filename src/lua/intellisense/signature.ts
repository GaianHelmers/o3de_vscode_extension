// ============================================================================
//  Signature parsing + AZ→Lua type mapping.
//
//  BehaviorContext exposes one free-text "debug argument info" string per method
//  (ScriptContextDebug). The auto-built form is:
//     "[=ResultType] argType1 argName1, argType2 argName2"
//  Hand-authored strings vary, so parsing is strictly best-effort — we degrade
//  to `any`/generic params rather than guessing wrong.
// ============================================================================

export interface ParsedParam {
  name: string;
  luaType: string;
}

export interface ParsedSignature {
  params: ParsedParam[];
  returnType?: string; // undefined = void/unknown → no @return emitted
  variadic: boolean;
}

// AZ / C++ type name → LuaLS type. Keys are the ReplaceCppArtifacts-cleaned
// names that appear in debugArgumentInfo (and a few raw fallbacks).
const TYPE_MAP: Record<string, string> = {
  void: "nil",
  bool: "boolean",
  char: "number",
  float: "number",
  double: "number",
  int: "number",
  int8: "number",
  int16: "number",
  int32: "number",
  int64: "number",
  uint8: "number",
  uint16: "number",
  uint32: "number",
  uint64: "number",
  s8: "number",
  s16: "number",
  s32: "number",
  s64: "number",
  u8: "number",
  u16: "number",
  u32: "number",
  u64: "number",
  string: "string",
  string_view: "string",
};

/** Map one AZ/C++ type token to a LuaLS type. Unknown class-like names pass through. */
export function mapAzTypeToLua(azType: string): string {
  const raw = azType.trim();
  if (!raw) {
    return "any";
  }

  // Container shapes: AZStd::vector<T> → T[]; map/unordered_map<K,V> → table<K,V>.
  const vec = raw.match(/(?:vector|fixed_vector|array|list)\s*<\s*(.+?)\s*>/i);
  if (vec) {
    return `${mapAzTypeToLua(vec[1].split(",")[0])}[]`;
  }
  const map = raw.match(/(?:unordered_map|map)\s*<\s*(.+?)\s*,\s*(.+?)\s*>/i);
  if (map) {
    return `table<${mapAzTypeToLua(map[1])}, ${mapAzTypeToLua(map[2])}>`;
  }

  // A char pointer is a C string (must be caught before we strip the `*`, which
  // would otherwise collapse it to a bare `char` → number).
  if (/\bchar\s*\*/.test(raw)) {
    return "string";
  }

  // Strip pointer/reference/const noise and namespaces for the lookup key.
  const cleaned = raw
    .replace(/\bconst\b/g, "")
    .replace(/[*&]/g, "")
    .replace(/AZStd::|AZ::/g, "")
    .trim();

  if (cleaned === "" ) {
    return "any";
  }
  if (TYPE_MAP[cleaned]) {
    return TYPE_MAP[cleaned];
  }
  // A bare identifier that looks like a reflected class name — keep it (it will
  // resolve to an ---@class we emit, or stay an opaque type name harmlessly).
  if (/^[A-Za-z_]\w*$/.test(cleaned)) {
    return cleaned;
  }
  return "any";
}

/** Parse a debugArgumentInfo string into params + return type. */
export function parseSignature(debugArgumentInfo: string): ParsedSignature {
  let info = (debugArgumentInfo ?? "").trim();
  let returnType: string | undefined;

  // Leading "[=ResultType]" → return type.
  const ret = info.match(/^\[=\s*([^\]]*)\]\s*/);
  if (ret) {
    const mapped = mapAzTypeToLua(ret[1]);
    returnType = mapped === "nil" ? undefined : mapped;
    info = info.slice(ret[0].length).trim();
  }

  if (info === "" ) {
    return { params: [], returnType, variadic: false };
  }
  if (info === "...") {
    return { params: [{ name: "...", luaType: "any" }], returnType, variadic: true };
  }

  const params: ParsedParam[] = [];
  let variadic = false;
  const parts = splitTopLevel(info, ",");
  parts.forEach((part, index) => {
    const token = part.trim();
    if (!token) {
      return;
    }
    if (token === "...") {
      variadic = true;
      params.push({ name: "...", luaType: "any" });
      return;
    }
    // "Type name" (name = last whitespace-separated token) or just "Type".
    const words = token.split(/\s+/);
    let name: string;
    let typeStr: string;
    if (words.length >= 2) {
      name = words[words.length - 1];
      typeStr = words.slice(0, -1).join(" ");
    } else {
      typeStr = words[0];
      name = `arg${index + 1}`;
    }
    if (!/^[A-Za-z_]\w*$/.test(name)) {
      name = `arg${index + 1}`;
    }
    params.push({ name, luaType: mapAzTypeToLua(typeStr) });
  });

  return { params, returnType, variadic };
}

// Split on `sep` but not inside <...> (so template commas don't break args).
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "<") {
      depth++;
    } else if (ch === ">") {
      depth = Math.max(0, depth - 1);
    }
    if (ch === sep && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    out.push(current);
  }
  return out;
}
