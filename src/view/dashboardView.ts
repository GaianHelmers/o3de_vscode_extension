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
import { DependencyStatus } from "../deps/dependencyStatus";
import { buildOnboardingModel, actionFor, View } from "../deps/registry";
import { runGuidedAction } from "../deps/actions";

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
  // Lua
  registerAsLuaEditor: "o3de.registerAsLuaEditor",
  newLuaScript: "o3de.newLuaScript",
  debugLuaFile: "o3de.debugLuaFile",
  generateLuaIntelliSense: "o3de.generateLuaIntelliSense",
  generateLuaStubsFromDump: "o3de.generateLuaStubsFromDump",
  openLuaPalette: "o3de.luaPalette.focus",
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
      {
        // Provisional home for the Lua commands (per user: end of Configuration
        // until a dedicated Lua UX lands).
        title: "Lua",
        rows: [
          { label: "Register VS Code as Lua Editor", cmd: "registerAsLuaEditor" },
          { label: "New Lua Script", cmd: "newLuaScript" },
          { label: "Debug Lua File", cmd: "debugLuaFile" },
          { label: "Generate Lua IntelliSense", cmd: "generateLuaIntelliSense" },
          { label: "Generate Stubs From Dump", cmd: "generateLuaStubsFromDump" },
          { label: "Open Lua Palette", cmd: "openLuaPalette" },
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
    private readonly deps: DependencyStatus,
  ) {
    this.lastComplete = onboarding.complete;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    webview.options = { enableScripts: true };
    webview.html = this.html(webview);

    webview.onDidReceiveMessage((msg: { command?: string; view?: View; action?: string }) => {
      if (msg.command) {
        const command = COMMANDS[msg.command];
        if (command) {
          void vscode.commands.executeCommand(command);
        }
        return;
      }
      if (msg.view) {
        void this.deps.setView(msg.view);
        return;
      }
      if (msg.action) {
        const action = actionFor(msg.action);
        if (action) {
          void runGuidedAction(action).then(() => this.deps.refresh());
        }
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
    const postDeps = (): void =>
      void webview.postMessage({ type: "deps", model: buildOnboardingModel(this.deps.resultMap, this.deps.view) });

    this.disposeSubs();
    this.subs.push(
      this.runState.onDidChange((running) => void webview.postMessage({ type: "runState", running })),
      this.onboarding.onDidChange(() => {
        postStatus();
        postConfig(); // canBuild/canRun depend on onboarding (project presence)
        postOnboarding();
      }),
      this.options.onDidChange(() => postConfig()),
      this.deps.onDidChange(() => postDeps()),
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
      deps: buildOnboardingModel(this.deps.resultMap, this.deps.view),
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

    /* ---- Guided setup ---- */
    .intents { display: flex; gap: 6px; padding: 2px 4px 8px; }
    .intent {
      flex: 1 1 0; height: 30px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;
      display: flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground); background: transparent;
    }
    .intent.on { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: transparent; }
    .intent:hover { background: var(--vscode-list-hoverBackground); }
    .intent.on:hover { background: var(--vscode-button-hoverBackground); }
    .viewmarker { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground); opacity: 0.7; padding: 0 4px 8px; }

    .reports { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 4px 8px; }
    .rep { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 8px; border-radius: 11px;
      border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
    .rep .dot { width: 8px; height: 8px; border-radius: 50%; }
    .rep.ok { border-color: color-mix(in srgb, var(--ok) 45%, transparent); color: var(--ok); }
    .rep.ok .dot { background: var(--ok); }
    .rep.no .dot { background: var(--bad); }

    .next {
      margin: 0 4px 10px; padding: 9px 10px; border-radius: 6px;
      background: var(--vscode-inputValidation-infoBackground, rgba(100,150,255,0.08));
      border: 1px solid var(--vscode-focusBorder);
    }
    .next .nlabel { font-size: 12px; font-weight: 600; margin-bottom: 3px; }
    .next .nwhat { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; line-height: 1.4; }
    .fixbtn {
      height: 26px; padding: 0 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;
      color: var(--vscode-button-foreground); background: var(--vscode-button-background);
    }
    .fixbtn:hover { background: var(--vscode-button-hoverBackground); }
    .fixbtn.small { height: 22px; padding: 0 8px; font-weight: 400;
      color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .fixbtn.small:hover { background: var(--vscode-button-secondaryHoverBackground); }

    .dep-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
    .dep-row:hover { background: var(--vscode-list-hoverBackground); }
    .dep-row .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .dep-row .dot.s-ok { background: var(--ok); }
    .dep-row .dot.s-missing { background: var(--bad); }
    .dep-row .dot.s-warn, .dep-row .dot.s-unknown { background: var(--warn); }
    .dep-row .dot.s-absent { background: var(--vscode-descriptionForeground); opacity: 0.5; }
    .dep-row .dlabel { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dep-row.isnext .dlabel { font-weight: 600; }
    .dep-row .ddetail { color: var(--vscode-descriptionForeground); font-size: 10px; max-width: 40%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

    <div class="sec open" id="sec-setup">
      <button class="sec-hdr" data-key="setup"><span class="chev">▶</span><span>Setup &amp; Onboarding</span><span class="sec-status" id="setup-status"></span></button>
      <div class="sec-body"><div id="deps"></div></div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const INITIAL = ${initial};
    const runBtn = document.getElementById('run');
    const buildBtn = document.getElementById('build');
    const statusEl = document.getElementById('status');
    const cfgEl = document.getElementById('config');
    const depsEl = document.getElementById('deps');
    const setupStatus = document.getElementById('setup-status');
    let celebrateTimer;
    let running = false, canBuild = false, canRun = false;

    function send(command) { vscode.postMessage({ command }); }
    function sendView(view) { vscode.postMessage({ view }); }
    function sendAction(id) { vscode.postMessage({ action: id }); }

    // ---- Collapsible sections (state persisted) ----
    function initCollapse() {
      const saved = vscode.getState() || { config: true, setup: true };
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
    function expandSetup() {
      const sec = document.getElementById('sec-setup');
      sec.classList.add('open');
      const st = vscode.getState() || {}; st.setup = true; vscode.setState(st);
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
        c.onclick = expandSetup;
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

    // ---- Guided setup (intent ramp + acquisition) ----
    function depRow(v) {
      const row = document.createElement('div');
      row.className = 'dep-row' + (v.isNext ? ' isnext' : '');
      row.title = v.what + (v.detail ? '\\n\\n' + v.detail : '');
      const dot = document.createElement('span'); dot.className = 'dot s-' + v.state; row.appendChild(dot);
      const label = document.createElement('span'); label.className = 'dlabel'; label.textContent = v.label; row.appendChild(label);
      if (v.detail && v.state === 'ok') {
        const d = document.createElement('span'); d.className = 'ddetail'; d.textContent = v.detail; row.appendChild(d);
      } else if (v.actionLabel && (v.state === 'missing' || v.state === 'warn' || v.state === 'absent' || v.state === 'unknown')) {
        const b = document.createElement('button'); b.className = 'fixbtn small'; b.textContent = v.actionLabel;
        b.onclick = () => sendAction(v.id); row.appendChild(b);
      }
      return row;
    }

    function setDeps(model) {
      depsEl.replaceChildren();

      // Track switcher (radio) — view/edit C++ OR Lua setup. The panel below
      // shows only the selected track; the badges show both tracks' status.
      const seg = document.createElement('div'); seg.className = 'intents';
      const mk = (key, text) => {
        const el = document.createElement('button');
        el.className = 'intent' + (model.view === key ? ' on' : '');
        el.textContent = text;
        el.onclick = () => sendView(key);
        return el;
      };
      seg.appendChild(mk('cpp', 'C++ setup'));
      seg.appendChild(mk('lua', 'Lua setup'));
      depsEl.appendChild(seg);

      const marker = document.createElement('div'); marker.className = 'viewmarker';
      marker.textContent = 'Showing ' + (model.view === 'cpp' ? 'C++' : 'Lua') + ' tools';
      depsEl.appendChild(marker);

      // Sub-reports (always both tracks): base / C++ / Lua ready + optionals count.
      const reports = document.createElement('div'); reports.className = 'reports';
      const rep = (ok, text) => {
        const s = document.createElement('span'); s.className = 'rep ' + (ok ? 'ok' : 'no');
        const d = document.createElement('span'); d.className = 'dot'; s.appendChild(d);
        const t = document.createElement('span'); t.textContent = text; s.appendChild(t);
        return s;
      };
      reports.appendChild(rep(model.readiness.base, 'Project ready'));
      reports.appendChild(rep(model.readiness.cpp, 'C++ ready'));
      reports.appendChild(rep(model.readiness.lua, 'Lua ready'));
      const opt = model.readiness.optionals;
      const optRep = document.createElement('span'); optRep.className = 'rep';
      optRep.textContent = 'Optionals ' + opt.present + '/' + opt.total; reports.appendChild(optRep);
      depsEl.appendChild(reports);
      setupStatus.replaceChildren();
      const sdot = document.createElement('span'); sdot.className = 'dot';
      sdot.style.background = model.next ? 'var(--bad)' : 'var(--ok)'; setupStatus.appendChild(sdot);

      // Next step — the single guided action to take now.
      if (model.next) {
        const card = document.createElement('div'); card.className = 'next';
        const l = document.createElement('div'); l.className = 'nlabel'; l.textContent = 'Next: ' + model.next.label; card.appendChild(l);
        const w = document.createElement('div'); w.className = 'nwhat'; w.textContent = model.next.what; card.appendChild(w);
        const b = document.createElement('button'); b.className = 'fixbtn'; b.textContent = model.next.actionLabel;
        b.onclick = () => sendAction(model.next.id); card.appendChild(b);
        depsEl.appendChild(card);
      }

      // The ramp (necessities for the chosen intents).
      const h1 = document.createElement('div'); h1.className = 'subhead'; h1.textContent = 'Required'; depsEl.appendChild(h1);
      const ramp = document.createElement('div'); ramp.className = 'rows';
      for (const v of model.ramp) { ramp.appendChild(depRow(v)); }
      depsEl.appendChild(ramp);

      // Optional extras.
      if (model.optionals.length) {
        const h2 = document.createElement('div'); h2.className = 'subhead'; h2.textContent = 'Optional'; depsEl.appendChild(h2);
        const optRows = document.createElement('div'); optRows.className = 'rows';
        for (const v of model.optionals) { optRows.appendChild(depRow(v)); }
        depsEl.appendChild(optRows);
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
      if (m.type === 'deps') { setDeps(m.model); }
    });

    initCollapse();
    setConfig(INITIAL.config);
    setDeps(INITIAL.deps);
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
