// ============================================================================
//  Lua Function Palette — a browsable, live-filtered view of the reflected API.
//
//  The VS Code equivalent of the built-in Lua IDE's "Class Reference" panel:
//  a Classes / EBuses / Globals tree fed by the same reflection dump that drives
//  IntelliSense (user/lua_symbols.json). A search bar docked at the top of the
//  section filters the tree live as you type; clicking a symbol inserts a call
//  snippet into the active Lua editor.
//
//  Implemented as a webview (a native TreeView can't host a persistent search
//  input above its rows). The extension side loads the dump and hands the whole
//  model to the webview; filtering + expand/collapse happen client-side so typing
//  stays instant. Lives as the second view under the O3DE container, alongside
//  the Dashboard; refreshes after a dump is generated.
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { detectProjectRoot } from "../projectPaths";
import { parseReflectionDump, ReflectionDump } from "../intellisense/symbols";
import { parseSignature } from "../intellisense/signature";
import { loadIcon } from "../../view/svgAssets";

export const LUA_PALETTE_VIEW_ID = "o3de.luaPalette";

// ---- Model handed to the webview -------------------------------------------

type MemberKind = "method" | "property" | "event" | "function" | "variable";

interface PaletteMember {
  label: string;
  detail: string; // signature / "read-only" / table name — the dim right-hand text
  tooltip: string;
  insert: string; // snippet inserted on click ($0 = cursor)
  kind: MemberKind;
}

interface PaletteContainer {
  name: string;
  kind: "class" | "ebus";
  members: PaletteMember[];
}

interface PaletteModel {
  hasDump: boolean;
  classes: PaletteContainer[];
  ebuses: PaletteContainer[];
  globals: PaletteMember[];
}

// ---- Provider --------------------------------------------------------------

export class LuaPaletteViewProvider implements vscode.WebviewViewProvider {
  private dump: ReflectionDump | undefined;
  private view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.load();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = { enableScripts: true };
    webview.html = this.html();

    webview.onDidReceiveMessage((msg: { type?: string; text?: string }) => {
      if (msg.type === "insert" && typeof msg.text === "string") {
        void insertLuaSymbol(msg.text);
      } else if (msg.type === "generate") {
        void vscode.commands.executeCommand("o3de.generateLuaIntelliSense");
      }
    });

    // Re-detect whenever the view is revealed — a dump may have been generated
    // externally (via the live Editor) since it was last shown.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    });
    this.post();
  }

  /** Reload the dump from disk and re-render the webview. */
  refresh(): void {
    this.load();
    this.post();
  }

  private post(): void {
    void this.view?.webview.postMessage({ type: "model", model: this.buildModel() });
  }

  // ---- Dump loading --------------------------------------------------------

  private load(): void {
    this.dump = undefined;
    const projectRoot = detectProjectRoot();
    if (!projectRoot) {
      return;
    }
    const dumpPath = path.join(projectRoot, "user", "lua_symbols.json");
    if (!fs.existsSync(dumpPath)) {
      return;
    }
    try {
      this.dump = parseReflectionDump(fs.readFileSync(dumpPath, "utf8"));
    } catch {
      this.dump = undefined;
    }
  }

  // ---- Model builder (no filtering — the webview filters live) -------------

  private buildModel(): PaletteModel {
    if (!this.dump) {
      return { hasDump: false, classes: [], ebuses: [], globals: [] };
    }
    return {
      hasDump: true,
      classes: this.classContainers(),
      ebuses: this.ebusContainers(),
      globals: this.globalMembers(),
    };
  }

  private classContainers(): PaletteContainer[] {
    return sortByName(this.dump?.classes ?? []).map((c) => {
      const methods = sortByName(c.methods).map<PaletteMember>((m) => {
        const sig = signatureText(m.debugArgumentInfo);
        return {
          label: m.name,
          detail: sig,
          tooltip: `${c.name}:${m.name}${sig} — method`,
          insert: `${m.name}($0)`,
          kind: "method",
        };
      });
      const properties = sortByName(c.properties).map<PaletteMember>((p) => ({
        label: p.name,
        detail: p.canWrite ? "" : "read-only",
        tooltip: `${c.name}.${p.name} — property (${p.canRead ? "R" : "-"}${p.canWrite ? "W" : "-"})`,
        insert: p.name,
        kind: "property",
      }));
      return { name: c.name, kind: "class", members: [...methods, ...properties] };
    });
  }

  private ebusContainers(): PaletteContainer[] {
    return sortByName(this.dump?.ebuses ?? []).map((b) => {
      const members = sortByName(b.senders).map<PaletteMember>((s) => {
        const sig = signatureText(s.debugArgumentInfo);
        const table = s.category === "Event" ? "Event" : s.category === "Broadcast" ? "Broadcast" : "Notification";
        const insert =
          s.category === "Notification"
            ? `${s.name}` // handler callback name
            : s.category === "Event"
              ? `${b.name}.Event.${s.name}($0)`
              : `${b.name}.Broadcast.${s.name}($0)`;
        return {
          label: s.name,
          detail: `${table}${sig}`,
          tooltip: `${b.name}.${table}.${s.name}${sig} — ${table.toLowerCase()}`,
          insert,
          kind: s.category === "Notification" ? "event" : "method",
        };
      });
      return { name: b.name, kind: "ebus", members };
    });
  }

  private globalMembers(): PaletteMember[] {
    const fns = sortByName(this.dump?.globalFunctions ?? []).map<PaletteMember>((f) => {
      const sig = signatureText(f.debugArgumentInfo);
      return { label: f.name, detail: sig, tooltip: `${f.name}${sig} — global function`, insert: `${f.name}($0)`, kind: "function" };
    });
    const props = sortByName(this.dump?.globalProperties ?? []).map<PaletteMember>((p) => ({
      label: p.name,
      detail: p.canWrite ? "" : "read-only",
      tooltip: `${p.name} — global property`,
      insert: p.name,
      kind: "variable",
    }));
    return [...fns, ...props];
  }

  // ---- HTML ----------------------------------------------------------------

  private html(): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const initial = JSON.stringify(this.buildModel());
    const ico = (name: string): string => loadIcon(this.extensionUri, name);
    // function shares the method glyph; variable shares the property glyph.
    const method = ico("sym-method");
    const property = ico("sym-property");
    const icons: PaletteIcons = {
      mag: ico("search"),
      x: ico("close"),
      chev: ico("chevron"),
      kinds: {
        class: ico("sym-class"),
        ebus: ico("sym-ebus"),
        method,
        function: method,
        property,
        variable: property,
        event: ico("sym-event"),
      },
    };
    return PALETTE_HTML(csp, nonce, initial, icons);
  }
}

interface PaletteIcons {
  mag: string;
  x: string;
  chev: string;
  kinds: Record<string, string>;
}

// ---- Insert command --------------------------------------------------------

/** Insert a palette symbol as a snippet at the cursor (or copy it if no editor). */
export async function insertLuaSymbol(insertText: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === "lua") {
    await editor.insertSnippet(new vscode.SnippetString(insertText));
    return;
  }
  await vscode.env.clipboard.writeText(insertText.replace("$0", ""));
  void vscode.window.showInformationMessage(`Copied "${insertText.replace("$0", "")}" to the clipboard.`);
}

// ---- Helpers ---------------------------------------------------------------

function signatureText(debugArgumentInfo: string): string {
  const sig = parseSignature(debugArgumentInfo);
  const params = sig.params.map((p) => `${p.name}: ${p.luaType}`).join(", ");
  const ret = sig.returnType ? `: ${sig.returnType}` : "";
  return `(${params})${ret}`;
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

// ---- Webview document ------------------------------------------------------
//
//  Self-contained page. The extension posts { type:"model", model } and the
//  script renders three collapsible categories (Classes / EBuses / Globals).
//  The docked search input filters live: a container shows when its own name
//  matches (all members visible) or when a member matches (only those visible);
//  any active filter auto-expands the hits. Clicking a member posts its snippet.

function PALETTE_HTML(csp: string, nonce: string, initial: string, icons: PaletteIcons): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body { padding: 0; margin: 0; }
    body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 13px; }

    /* Docked search bar */
    .search { position: sticky; top: 0; z-index: 2; padding: 6px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
    .search-wrap { position: relative; display: flex; align-items: center; }
    .search-wrap .mag { position: absolute; left: 7px; opacity: 0.6; pointer-events: none; display: flex; }
    #q {
      width: 100%; box-sizing: border-box; height: 26px; padding: 0 24px 0 26px;
      color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; outline: none;
      font-family: var(--vscode-font-family); font-size: 12px;
    }
    #q:focus { border-color: var(--vscode-focusBorder); }
    #q::placeholder { color: var(--vscode-input-placeholderForeground); }
    .clear { position: absolute; right: 5px; display: none; cursor: pointer; opacity: 0.7; border: none; background: transparent; color: inherit; padding: 2px; }
    .clear:hover { opacity: 1; }
    .search.filtering .clear { display: flex; }

    /* Tree */
    .tree { padding: 2px 0 8px; }
    .cat > .cat-hdr {
      display: flex; align-items: center; gap: 4px; width: 100%; box-sizing: border-box;
      padding: 3px 8px; cursor: pointer; background: transparent; border: none; color: var(--vscode-descriptionForeground);
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    }
    .cat > .cat-hdr:hover { background: var(--vscode-list-hoverBackground); }
    .row {
      display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box;
      padding: 3px 8px; cursor: pointer; background: transparent; border: none; color: var(--vscode-foreground);
      text-align: left; font-family: var(--vscode-font-family); font-size: 13px;
    }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .row.container { color: var(--vscode-foreground); }
    .row.member { padding-left: 28px; }
    .chev { width: 12px; flex: 0 0 auto; opacity: 0.8; transition: transform 100ms ease; display: inline-flex; justify-content: center; }
    .chev.open { transform: rotate(90deg); }
    .chev.leaf { visibility: hidden; }
    .ico { width: 16px; height: 16px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }
    .name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail { color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%; }
    .count { color: var(--vscode-descriptionForeground); opacity: 0.7; font-weight: 400; }

    /* symbol-kind icon colors (fall back to foreground) */
    .k-method, .k-function { color: var(--vscode-symbolIcon-methodForeground, #b180d7); }
    .k-property, .k-variable { color: var(--vscode-symbolIcon-propertyForeground, var(--vscode-foreground)); }
    .k-event { color: var(--vscode-symbolIcon-eventForeground, #d67e3c); }
    .k-class { color: var(--vscode-symbolIcon-classForeground, #ee9d28); }
    .k-ebus { color: var(--vscode-symbolIcon-eventForeground, #d67e3c); }

    /* Empty / no-dump states */
    .empty { padding: 14px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.5; }
    .empty button {
      margin-top: 10px; height: 28px; padding: 0 12px; border: none; border-radius: 4px; cursor: pointer;
      color: var(--vscode-button-foreground); background: var(--vscode-button-background); font-size: 12px; font-weight: 600;
    }
    .empty button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="search" id="search">
    <div class="search-wrap">
      <span class="mag">${icons.mag}</span>
      <input id="q" type="text" placeholder="Filter classes, methods, EBuses…" spellcheck="false" autocomplete="off" />
      <button class="clear" id="clear" title="Clear filter">${icons.x}</button>
    </div>
  </div>
  <div class="tree" id="tree"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const ICONS = ${JSON.stringify(icons.kinds)};
    const CHEV_SVG = ${JSON.stringify(icons.chev)};
    let model = ${initial};

    const treeEl = document.getElementById('tree');
    const searchEl = document.getElementById('search');
    const q = document.getElementById('q');
    const clearBtn = document.getElementById('clear');

    // Expand state (ephemeral) for the no-filter view. Categories start collapsed.
    const openCats = new Set();
    const openContainers = new Set();

    function send(msg) { vscode.postMessage(msg); }
    const norm = (s) => s.toLowerCase();

    // ---- Filtering ----
    function filterContainer(c, f) {
      if (!f) { return { name: c.name, kind: c.kind, members: c.members, all: true }; }
      if (norm(c.name).includes(f)) { return { name: c.name, kind: c.kind, members: c.members, all: true }; }
      const members = c.members.filter((m) => norm(m.label).includes(f));
      return members.length ? { name: c.name, kind: c.kind, members, all: false } : null;
    }

    // ---- Rendering ----
    function iconSpan(kind) {
      const s = document.createElement('span');
      s.className = 'ico k-' + kind;
      s.innerHTML = ICONS[kind] || '';
      return s;
    }
    function memberRow(m) {
      const row = document.createElement('button');
      row.className = 'row member';
      row.title = m.tooltip;
      const chev = document.createElement('span'); chev.className = 'chev leaf'; row.appendChild(chev);
      row.appendChild(iconSpan(m.kind));
      const name = document.createElement('span'); name.className = 'name'; name.textContent = m.label; row.appendChild(name);
      if (m.detail) { const d = document.createElement('span'); d.className = 'detail'; d.textContent = m.detail; row.appendChild(d); }
      row.onclick = () => send({ type: 'insert', text: m.insert });
      return row;
    }
    // Per-frame row budget: a broad 1–2 char filter can match thousands of rows;
    // building them all in one frame janks. We cap rows rendered per rebuild and
    // append a "keep typing" note — narrowing the filter reveals the rest.
    const MAX_ROWS = 400;

    function appendContainer(sec, c, forceOpen, budget) {
      if (budget.left <= 0) { budget.truncated = true; return; }
      budget.left--;
      const open = forceOpen || openContainers.has(c.kind + ':' + c.name);
      const row = document.createElement('button'); row.className = 'row container';
      const chev = document.createElement('span'); chev.className = 'chev' + (open ? ' open' : ''); chev.innerHTML = CHEV_SVG; row.appendChild(chev);
      row.appendChild(iconSpan(c.kind));
      const name = document.createElement('span'); name.className = 'name'; name.textContent = c.name; row.appendChild(name);
      const cnt = document.createElement('span'); cnt.className = 'detail'; cnt.textContent = c.members.length; row.appendChild(cnt);
      row.onclick = () => {
        const key = c.kind + ':' + c.name;
        if (openContainers.has(key)) { openContainers.delete(key); } else { openContainers.add(key); }
        scheduleRender();
      };
      sec.appendChild(row);
      if (open) {
        for (const m of c.members) {
          if (budget.left <= 0) { budget.truncated = true; break; }
          budget.left--;
          sec.appendChild(memberRow(m));
        }
      }
    }
    function categorySection(key, title, containers, forceOpen, budget) {
      const sec = document.createElement('div'); sec.className = 'cat';
      const open = forceOpen || openCats.has(key);
      const hdr = document.createElement('button'); hdr.className = 'cat-hdr';
      const chev = document.createElement('span'); chev.className = 'chev' + (open ? ' open' : ''); chev.innerHTML = CHEV_SVG; hdr.appendChild(chev);
      const t = document.createElement('span'); t.textContent = title; hdr.appendChild(t);
      const cnt = document.createElement('span'); cnt.className = 'count'; cnt.textContent = '(' + containers.length + ')'; hdr.appendChild(cnt);
      hdr.onclick = () => { if (openCats.has(key)) { openCats.delete(key); } else { openCats.add(key); } scheduleRender(); };
      sec.appendChild(hdr);
      if (open) { for (const c of containers) { if (budget.left <= 0) { budget.truncated = true; break; } appendContainer(sec, c, forceOpen, budget); } }
      return sec;
    }
    function globalsSection(members, forceOpen, budget) {
      const sec = document.createElement('div'); sec.className = 'cat';
      const open = forceOpen || openCats.has('globals');
      const hdr = document.createElement('button'); hdr.className = 'cat-hdr';
      const chev = document.createElement('span'); chev.className = 'chev' + (open ? ' open' : ''); chev.innerHTML = CHEV_SVG; hdr.appendChild(chev);
      const t = document.createElement('span'); t.textContent = 'Globals'; hdr.appendChild(t);
      const cnt = document.createElement('span'); cnt.className = 'count'; cnt.textContent = '(' + members.length + ')'; hdr.appendChild(cnt);
      hdr.onclick = () => { if (openCats.has('globals')) { openCats.delete('globals'); } else { openCats.add('globals'); } scheduleRender(); };
      sec.appendChild(hdr);
      if (open) { for (const m of members) { if (budget.left <= 0) { budget.truncated = true; break; } budget.left--; sec.appendChild(memberRow(m)); } }
      return sec;
    }

    function render() {
      if (!model.hasDump) {
        const box = document.createElement('div'); box.className = 'empty';
        box.append('No reflected API yet. Generate it from the running Editor to browse the O3DE Lua API here.');
        const b = document.createElement('button'); b.textContent = 'Generate Lua IntelliSense';
        b.onclick = () => send({ type: 'generate' }); box.appendChild(document.createElement('br')); box.appendChild(b);
        treeEl.replaceChildren(box);
        return;
      }
      const f = norm(q.value.trim());
      searchEl.classList.toggle('filtering', f !== '');

      const classes = model.classes.map((c) => filterContainer(c, f)).filter(Boolean);
      const ebuses = model.ebuses.map((c) => filterContainer(c, f)).filter(Boolean);
      const globals = f ? model.globals.filter((m) => norm(m.label).includes(f)) : model.globals;

      if (f && !classes.length && !ebuses.length && !globals.length) {
        const box = document.createElement('div'); box.className = 'empty';
        box.textContent = 'No API symbols match "' + q.value.trim() + '".';
        treeEl.replaceChildren(box);
        return;
      }

      // A filter forces categories + matching containers open so hits are visible.
      const forced = f !== '';
      const budget = { left: MAX_ROWS, truncated: false };
      const frag = document.createDocumentFragment();
      frag.appendChild(categorySection('classes', 'Classes', classes, forced, budget));
      frag.appendChild(categorySection('ebuses', 'EBuses', ebuses, forced, budget));
      frag.appendChild(globalsSection(globals, forced, budget));
      if (budget.truncated) {
        const note = document.createElement('div'); note.className = 'empty';
        note.textContent = 'Showing the first ' + MAX_ROWS + ' rows — keep typing to narrow.';
        frag.appendChild(note);
      }
      treeEl.replaceChildren(frag); // one reflow per frame
    }

    // Coalesce rebuilds to one per animation frame so the keystroke paints first
    // (typing stays responsive) and fast typing never queues N full rebuilds.
    let rafPending = false;
    function scheduleRender() {
      if (rafPending) { return; }
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; render(); });
    }

    // ---- Wiring ----
    q.addEventListener('input', scheduleRender);
    clearBtn.onclick = () => { q.value = ''; q.focus(); scheduleRender(); };
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m && m.type === 'model') { model = m.model; render(); }
    });
    render();
  </script>
</body>
</html>`;
}

