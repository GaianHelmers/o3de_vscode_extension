// ============================================================================
//  O3DE Development Tools — the single control panel for the O3DE tab.
//
//  One webview owns the whole surface (it is the container's only view, so VS
//  Code hides the per-view header and this reads as one "O3DE Development Tools"
//  panel). Everything lives here, styled by us:
//
//    BUILD & RUN            header carries the discreet status readout on the
//    [ Build ] [ Run ]      right (● Ready, or attention pills). Build/Run
//                           disable when there's no project to act on.
//    UTILITIES              Show Log · Terminal · Editor Log · Error Log
//    ── divider ──
//    ▸ CONFIGURATION        collapsible — Build Options / Project Setup / Launch
//    ▸ ONBOARDING           collapsible — Prerequisites / Workspace (status dots)
//
//  Collapse state persists via the webview state API. Status: satisfied checks
//  fold into one green cluster; only items needing attention surface as named
//  pills (red = missing → install on demand, yellow = update available).
// ============================================================================

import * as vscode from "vscode";
import { RunState } from "../build/runState";
import { OnboardingStatus } from "./onboardingStatus";
import { BuildOptions } from "../build/buildOptions";
import { targetsLabel } from "../build/buildCommand";
import { launchArgsLabel } from "../build/runCommand";

// ---- Webview → command dispatch table (whitelist) --------------------------
const COMMANDS: Record<string, string> = {
  build: "o3de.build",
  run: "o3de.run",
  stop: "o3de.stopRun",
  terminal: "o3de.openDeveloperTerminal",
  log: "o3de.showLog",
  editorLog: "o3de.showEditorLog",
  errorLog: "o3de.showErrorLog",
  checkVs: "o3de.checkVisualStudio",
  checkNinja: "o3de.checkNinja",
  setup: "o3de.setupWorkspace",
  addGems: "o3de.addGems",
  selectGenerator: "o3de.selectGenerator",
  selectConfig: "o3de.selectConfig",
  selectTargets: "o3de.selectTargets",
  writeProjectConfig: "o3de.writeProjectConfig",
  configureProject: "o3de.configureProject",
  generateCppProperties: "o3de.generateCppProperties",
  selectRunTarget: "o3de.selectRunTarget",
  setLaunchArgs: "o3de.setLaunchArgs",
};

// ---- Inline icons (self-contained — no asset plumbing / CSP img-src) --------
const TOOLS_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 1 0 1.4l-.7.7a1 1 0 0 1-1.4 0l-1.6-1.6a1 1 0 0 0-1.4 0' +
  'L5 18.3a2.12 2.12 0 0 1-3-3l6.3-6.3a1 1 0 0 0 0-1.4L5.7 6a1 1 0 0 1 0-1.4l.7-.7a1 1 0 0 1 1.4 0L9.4 5.5' +
  'a1 1 0 0 0 1.4 0l2.9-2.9a5 5 0 0 0-6.6 6.6"/></svg>';
const TERMINAL_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 4l3.5 4L3 12"/><path d="M8.5 12H13"/></svg>';
const LOG_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round"><path d="M3 4h10"/><path d="M3 8h10"/><path d="M3 12h7"/></svg>';

// ---- Payloads --------------------------------------------------------------
type LightState = "warn" | "bad";
interface AttentionPill {
  label: string;
  state: LightState;
  cmd: string;
  hint: string;
}
interface StatusPayload {
  justCompleted: boolean;
  readyCount: number;
  total: number;
  attention: AttentionPill[];
}

function workspaceSummary(o: OnboardingStatus): string {
  return `${o.hasProject ? "project ✓" : "project ✗"} · ${o.hasEngineSource ? "engine ✓" : "engine ✗"}`;
}

function statusPayload(o: OnboardingStatus, justCompleted: boolean): StatusPayload {
  const checks = [
    { label: "Visual Studio", ok: o.hasVisualStudio, warn: false, cmd: "checkVs" },
    { label: "Ninja", ok: o.hasNinja, warn: o.hasNinja && o.ninjaUpdateAvailable, cmd: "checkNinja" },
    { label: "Project", ok: o.hasProject, warn: false, cmd: "setup" },
    { label: "Engine", ok: o.hasEngineSource, warn: false, cmd: "setup" },
  ];
  const attention: AttentionPill[] = checks
    .filter((c) => !c.ok || c.warn)
    .map((c) => ({
      label: c.label,
      state: c.ok ? "warn" : "bad",
      cmd: c.cmd,
      hint: c.ok
        ? `${c.label} — update available. Click to update.`
        : `${c.label} — missing. Click to install / set up.`,
    }));
  return {
    justCompleted,
    readyCount: checks.filter((c) => c.ok && !c.warn).length,
    total: checks.length,
    attention,
  };
}

function configPayload(options: BuildOptions, onboarding: OnboardingStatus) {
  return {
    // Both gate on "a project is present" — the real precondition (generator/
    // config/runTarget always have defaults, so there's no other unset state).
    canBuild: onboarding.hasProject,
    canRun: onboarding.hasProject,
    sections: [
      {
        title: "Build Options",
        rows: [
          { label: "Generator", value: options.generator, cmd: "selectGenerator" },
          { label: "Config", value: options.config, cmd: "selectConfig" },
          { label: "Targets", value: targetsLabel(options.targets), cmd: "selectTargets" },
        ],
      },
      {
        title: "Project Setup",
        rows: [
          { label: "Write Project Config", cmd: "writeProjectConfig" },
          { label: "Configure Project", cmd: "configureProject" },
          { label: "Generate C++ IntelliSense", cmd: "generateCppProperties" },
        ],
      },
      {
        title: "Launch Settings",
        rows: [
          { label: "Run Target", value: options.runTarget, cmd: "selectRunTarget" },
          { label: "Launch Options", value: launchArgsLabel(options.launchArgs), cmd: "setLaunchArgs" },
        ],
      },
    ],
  };
}

function onboardingPayload(o: OnboardingStatus) {
  return {
    complete: o.complete,
    groups: [
      {
        title: "Prerequisites",
        rows: [
          { label: "Visual Studio", ok: o.hasVisualStudio, value: o.hasVisualStudio ? "ready" : "not found", cmd: "checkVs" },
          { label: "Ninja", ok: o.hasNinja, value: o.hasNinja ? "installed" : "not found", cmd: "checkNinja" },
        ],
      },
      {
        title: "Workspace",
        rows: [
          { label: "Set Up O3DE Workspace…", ok: o.workspaceComplete, value: workspaceSummary(o), cmd: "setup" },
          { label: "Add Gems / Folders…", cmd: "addGems" },
        ],
      },
    ],
  };
}

// ---- Provider --------------------------------------------------------------
export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "o3de.dashboard";
  private subs: vscode.Disposable[] = [];
  private lastComplete: boolean;

  constructor(
    private readonly runState: RunState,
    private readonly onboarding: OnboardingStatus,
    private readonly options: BuildOptions,
  ) {
    this.lastComplete = onboarding.complete;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    webview.options = { enableScripts: true };
    webview.html = this.html(webview);

    webview.onDidReceiveMessage((msg: { command?: string }) => {
      const command = msg.command ? COMMANDS[msg.command] : undefined;
      if (command) {
        void vscode.commands.executeCommand(command);
      }
    });

    const postStatus = (): void => {
      const complete = this.onboarding.complete;
      const justCompleted = complete && !this.lastComplete;
      this.lastComplete = complete;
      void webview.postMessage({ type: "status", ...statusPayload(this.onboarding, justCompleted) });
    };
    const postConfig = (): void =>
      void webview.postMessage({ type: "config", ...configPayload(this.options, this.onboarding) });
    const postOnboarding = (): void =>
      void webview.postMessage({ type: "onboarding", ...onboardingPayload(this.onboarding) });

    this.disposeSubs();
    this.subs.push(
      this.runState.onDidChange((running) => void webview.postMessage({ type: "runState", running })),
      this.onboarding.onDidChange(() => {
        postStatus();
        postConfig(); // canBuild/canRun depend on onboarding (project presence)
        postOnboarding();
      }),
      this.options.onDidChange(() => postConfig()),
    );
    webviewView.onDidDispose(() => this.disposeSubs());
  }

  private disposeSubs(): void {
    for (const s of this.subs) {
      s.dispose();
    }
    this.subs = [];
  }

  // ---- HTML ----------------------------------------------------------------
  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp =
      `default-src 'none'; style-src 'unsafe-inline'; ` +
      `script-src 'nonce-${nonce}'; img-src ${webview.cspSource};`;
    const initial = JSON.stringify({
      running: this.runState.isRunning,
      status: statusPayload(this.onboarding, false),
      config: configPayload(this.options, this.onboarding),
      onboarding: onboardingPayload(this.onboarding),
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --ok: var(--vscode-testing-iconPassed, #89d185);
      --warn: var(--vscode-testing-iconQueued, #cca700);
      --bad: var(--vscode-testing-iconFailed, #f14c4c);
    }
    html, body { padding: 0; margin: 0; }
    .panel { display: flex; flex-direction: column; gap: 12px; padding: 10px; }
    .group { display: flex; flex-direction: column; gap: 6px; }
    .label {
      font-size: 10px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase;
      color: var(--vscode-descriptionForeground); opacity: 0.8;
    }
    .hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

    /* Status readout (in the Build & Run header) */
    .status { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 5px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; display: inline-block; }
    .chip {
      display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
      border-radius: 11px; padding: 2px 8px; font-size: 11px; line-height: 1.4;
      border: 1px solid transparent; transition: background 80ms ease;
      color: var(--vscode-foreground); background: var(--vscode-badge-background);
    }
    .chip:hover { background: var(--vscode-toolbar-hoverBackground); }
    .chip:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .chip.ready { background: transparent; border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
    .chip.ready .dot { background: var(--ok); }
    .chip.ready .count { color: var(--ok); font-weight: 600; }
    .chip.bad { border-color: color-mix(in srgb, var(--bad) 55%, transparent); }
    .chip.bad .dot { background: var(--bad); }
    .chip.warn { border-color: color-mix(in srgb, var(--warn) 60%, transparent); }
    .chip.warn .dot { background: var(--warn); }
    .allclear { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .allclear .dot { background: var(--ok); }
    .allclear.celebrate { color: var(--ok); font-weight: 600; }

    /* Button rows */
    .row { display: flex; gap: 6px; align-items: stretch; flex-wrap: wrap; }
    button {
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      height: 30px; border: none; border-radius: 4px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      color: var(--vscode-button-foreground); background: var(--vscode-button-background);
      transition: background 80ms ease, filter 80ms ease;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    button:disabled { opacity: 0.4; cursor: default; }
    button:disabled:hover { background: var(--vscode-button-background); }
    .primary { flex: 1 1 0; font-weight: 600; min-width: 96px; }
    .icon {
      flex: 0 0 auto; width: 36px;
      color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
    }
    .icon:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .util-link {
      flex: 1 1 auto; padding: 0 10px; font-size: 11px;
      color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
    }
    .util-link:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .stop { background: var(--vscode-statusBarItem-errorBackground, #b91c1c); color: #ffffff; }
    .stop:hover { background: var(--vscode-statusBarItem-errorBackground, #b91c1c); filter: brightness(1.12); }
    .stop:disabled { opacity: 0.4; }

    .divider { height: 1px; background: var(--vscode-panel-border); margin: 2px 0; opacity: 0.7; }

    /* Collapsible sections */
    .sec { display: flex; flex-direction: column; }
    .sec-hdr {
      justify-content: flex-start; gap: 6px; height: 26px; padding: 0 4px; border-radius: 4px;
      background: transparent; color: var(--vscode-descriptionForeground);
      font-size: 10px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase;
    }
    .sec-hdr:hover { background: var(--vscode-list-hoverBackground); }
    .chev { font-size: 10px; transition: transform 120ms ease; opacity: 0.8; }
    .sec.open > .sec-hdr .chev { transform: rotate(90deg); }
    .sec-status { margin-left: auto; }
    .sec-body { display: none; padding: 2px 0 2px; flex-direction: column; gap: 6px; }
    .sec.open > .sec-body { display: flex; }

    /* Config / onboarding rows */
    .subhead { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
      color: var(--vscode-descriptionForeground); opacity: 0.6; padding: 0 8px 3px; margin-top: 16px; }
    .subhead:first-child { margin-top: 2px; }
    .rows { display: flex; flex-direction: column; }
    .cfg-row {
      height: auto; justify-content: space-between; gap: 8px; padding: 5px 8px; border-radius: 4px;
      font-size: 12px; font-weight: 400; background: transparent; color: var(--vscode-foreground);
    }
    .cfg-row:hover { background: var(--vscode-list-hoverBackground); }
    .rowlead { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .rowlead .dot.okdot { background: var(--ok); }
    .rowlead .dot.baddot { background: var(--bad); }
    .val {
      color: var(--vscode-descriptionForeground); font-size: 11px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 52%;
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="group">
      <div class="hdr">
        <span class="label">Build &amp; Run</span>
        <span class="status" id="status"></span>
      </div>
      <div class="row">
        <button id="build" class="primary" title="Build the selected target(s) with the current config">${TOOLS_SVG}<span>Build</span></button>
        <button id="run" class="primary" title="Launch the selected run target"><span>▶ Run</span></button>
      </div>
    </div>

    <div class="group">
      <div class="label">Utilities</div>
      <div class="row">
        <button id="log" class="icon" title="Reveal the O3DE Development Tools output channel">${LOG_SVG}</button>
        <button id="terminal" class="icon" title="Open a terminal with the MSVC environment established">${TERMINAL_SVG}</button>
        <button id="editorLog" class="util-link" title="Open the O3DE Editor.log for this project">Editor Log</button>
        <button id="errorLog" class="util-link" title="Open the O3DE Error.log for this project">Error Log</button>
      </div>
    </div>

    <div class="divider"></div>

    <div class="sec" id="sec-config">
      <button class="sec-hdr" data-key="config"><span class="chev">▶</span><span>Configuration</span></button>
      <div class="sec-body"><div id="config"></div></div>
    </div>

    <div class="sec" id="sec-onboarding">
      <button class="sec-hdr" data-key="onboarding"><span class="chev">▶</span><span>Onboarding</span><span class="sec-status"><span class="dot" id="ob-dot"></span></span></button>
      <div class="sec-body"><div id="onboarding"></div></div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const INITIAL = ${initial};
    const runBtn = document.getElementById('run');
    const buildBtn = document.getElementById('build');
    const statusEl = document.getElementById('status');
    const cfgEl = document.getElementById('config');
    const obEl = document.getElementById('onboarding');
    const obDot = document.getElementById('ob-dot');
    let celebrateTimer;
    let running = false, canBuild = false, canRun = false;

    function send(command) { vscode.postMessage({ command }); }

    // ---- Collapsible sections (state persisted) ----
    function initCollapse() {
      const saved = vscode.getState() || { config: true, onboarding: false };
      document.querySelectorAll('.sec-hdr').forEach((h) => {
        const key = h.dataset.key;
        const sec = h.parentElement;
        if (saved[key]) { sec.classList.add('open'); }
        h.onclick = () => {
          sec.classList.toggle('open');
          const st = vscode.getState() || {};
          st[key] = sec.classList.contains('open');
          vscode.setState(st);
        };
      });
    }
    function expandOnboarding() {
      const sec = document.getElementById('sec-onboarding');
      sec.classList.add('open');
      const st = vscode.getState() || {}; st.onboarding = true; vscode.setState(st);
      sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ---- Build & Run enablement ----
    function applyEnable() {
      buildBtn.disabled = !canBuild;
      buildBtn.title = canBuild
        ? 'Build the selected target(s) with the current config'
        : 'No O3DE project in the workspace — complete Onboarding first';
      runBtn.disabled = !running && !canRun;
      if (!running) {
        runBtn.title = canRun ? 'Launch the selected run target' : 'No run target — set up a project first';
      }
    }
    function setRunning(v) {
      running = v;
      runBtn.classList.toggle('stop', running);
      runBtn.dataset.cmd = running ? 'stop' : 'run';
      runBtn.firstChild.textContent = running ? '■ Stop' : '▶ Run';
      if (running) { runBtn.title = 'Force-quit the running app and its process tree'; }
      applyEnable();
    }

    // ---- Status readout ----
    function setStatus(s) {
      clearTimeout(celebrateTimer);
      statusEl.replaceChildren();
      if (s.attention.length === 0) {
        const wrap = document.createElement('span');
        wrap.className = 'allclear' + (s.justCompleted ? ' celebrate' : '');
        const d = document.createElement('span'); d.className = 'dot'; wrap.appendChild(d);
        const t = document.createElement('span');
        t.textContent = s.justCompleted ? 'All systems go' : 'Ready';
        wrap.appendChild(t);
        statusEl.appendChild(wrap);
        if (s.justCompleted) {
          celebrateTimer = setTimeout(() => { wrap.classList.remove('celebrate'); t.textContent = 'Ready'; }, 4000);
        }
        return;
      }
      if (s.readyCount > 0) {
        const c = document.createElement('button');
        c.className = 'chip ready';
        c.title = s.readyCount + ' of ' + s.total + ' ready — click to review in Onboarding';
        const d = document.createElement('span'); d.className = 'dot'; c.appendChild(d);
        const n = document.createElement('span'); n.className = 'count'; n.textContent = String(s.readyCount); c.appendChild(n);
        c.onclick = expandOnboarding;
        statusEl.appendChild(c);
      }
      for (const a of s.attention) {
        const p = document.createElement('button');
        p.className = 'chip ' + a.state; p.title = a.hint;
        const d = document.createElement('span'); d.className = 'dot'; p.appendChild(d);
        const l = document.createElement('span'); l.textContent = a.label; p.appendChild(l);
        p.onclick = () => send(a.cmd);
        statusEl.appendChild(p);
      }
    }

    // ---- Row builders ----
    function valueRow(r, withDot) {
      const row = document.createElement('button'); row.className = 'cfg-row';
      const lead = document.createElement('span'); lead.className = 'rowlead';
      if (withDot && r.ok !== undefined) {
        const d = document.createElement('span'); d.className = 'dot ' + (r.ok ? 'okdot' : 'baddot'); lead.appendChild(d);
      }
      const l = document.createElement('span'); l.textContent = r.label; lead.appendChild(l);
      row.appendChild(lead);
      if (r.value !== undefined) {
        const v = document.createElement('span'); v.className = 'val'; v.textContent = r.value; row.appendChild(v);
      }
      row.onclick = () => send(r.cmd);
      return row;
    }

    function setConfig(cfg) {
      canBuild = cfg.canBuild; canRun = cfg.canRun; applyEnable();
      cfgEl.replaceChildren();
      for (const section of cfg.sections) {
        const h = document.createElement('div'); h.className = 'subhead'; h.textContent = section.title; cfgEl.appendChild(h);
        const rows = document.createElement('div'); rows.className = 'rows';
        for (const r of section.rows) { rows.appendChild(valueRow(r, false)); }
        cfgEl.appendChild(rows);
      }
    }

    function setOnboarding(ob) {
      obDot.style.background = ob.complete ? 'var(--ok)' : 'var(--bad)';
      obEl.replaceChildren();
      for (const g of ob.groups) {
        const h = document.createElement('div'); h.className = 'subhead'; h.textContent = g.title; obEl.appendChild(h);
        const rows = document.createElement('div'); rows.className = 'rows';
        for (const r of g.rows) { rows.appendChild(valueRow(r, true)); }
        obEl.appendChild(rows);
      }
    }

    // ---- Wire static buttons ----
    buildBtn.onclick = () => { if (!buildBtn.disabled) { send('build'); } };
    runBtn.onclick = () => { if (!runBtn.disabled) { send(runBtn.dataset.cmd === 'stop' ? 'stop' : 'run'); } };
    document.getElementById('terminal').onclick = () => send('terminal');
    document.getElementById('log').onclick = () => send('log');
    document.getElementById('editorLog').onclick = () => send('editorLog');
    document.getElementById('errorLog').onclick = () => send('errorLog');

    window.addEventListener('message', (e) => {
      const m = e.data;
      if (!m) { return; }
      if (m.type === 'runState') { setRunning(m.running); }
      if (m.type === 'status') { setStatus(m); }
      if (m.type === 'config') { setConfig(m); }
      if (m.type === 'onboarding') { setOnboarding(m); }
    });

    initCollapse();
    setConfig(INITIAL.config);
    setOnboarding(INITIAL.onboarding);
    setRunning(INITIAL.running);
    setStatus(INITIAL.status);
  </script>
</body>
</html>`;
  }
}

// ---- Nonce (CSP) -----------------------------------------------------------
function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
