// ============================================================================
//  Dependency registry — the exhaustive, tiered, track-keyed set of checks.
//
//  This is the data model behind the guided Onboarding ramp. Each dependency is
//  declared once with its category, tier, track, detector, plain-language "what
//  is this", and a guided action for when it's missing. Pure roll-up helpers
//  compute per-track satisfaction and the single next actionable step for the
//  user's chosen intent — so a beginner is walked to a working configuration.
//
//  Tracks (additive): base (always) → cpp (C++ IntelliSense) → lua (authoring +
//  debug). Everything else is "optional" — available and robust, never blocking.
// ============================================================================

import { CheckResult, CheckState } from "./detectors";
import * as d from "./detectors";

export type Track = "base" | "cpp" | "lua" | "optional";
export type Tier = "required" | "recommended" | "optional" | "info";
export type Category = "toolchain" | "engine" | "cpp" | "lua" | "system";

export interface GuidedAction {
  label: string;
  // How the UI fulfils it. `command` runs a VS Code command; `winget` installs a
  // package; `extension` installs a VS Code extension; `url` opens docs/download;
  // `longpaths` enables the registry flag; `enableGem` enables the RemoteTools gem.
  kind: "command" | "winget" | "extension" | "url" | "longpaths" | "enableGem";
  payload: string;
}

export interface DependencyCheck {
  id: string;
  label: string;
  what: string; // plain-language explanation for a beginner
  category: Category;
  tier: Tier;
  track: Track;
  detect: () => CheckResult | Promise<CheckResult>;
  action?: GuidedAction;
  docUrl?: string;
  // Platforms this check applies to (undefined = all). Lets the ramp interpret
  // needs per OS: e.g. Visual Studio / Windows SDK / long-paths are Windows-only,
  // gcc is Linux, while CMake / Ninja / engine / project are cross-platform.
  platforms?: NodeJS.Platform[];
  // For OPTIONAL checks: which track view(s) they show under (undefined = both).
  // e.g. Clang/CMake-Tools/Python are C++-only — Lua doesn't care about them.
  views?: Array<"cpp" | "lua">;
}

// ---- The registry ----------------------------------------------------------

export const CHECKS: DependencyCheck[] = [
  // BASE — the bare minimum: a project on a registered engine (SDK or source).
  {
    id: "engine",
    label: "Registered O3DE engine",
    what: "A registered O3DE engine — prebuilt SDK or source. With none installed at all, the first step is to get O3DE itself.",
    category: "engine",
    tier: "required",
    track: "base",
    detect: d.detectEngine,
    // Cold start: no engine anywhere → the only move is to acquire O3DE.
    action: { label: "Get O3DE", kind: "url", payload: "https://o3de.org/download/" },
  },
  {
    id: "project",
    label: "O3DE project",
    what: "An O3DE project (a folder with project.json) open in this workspace.",
    category: "engine",
    tier: "required",
    track: "base",
    detect: d.detectProject,
    action: { label: "Set Up Workspace…", kind: "command", payload: "o3de.setupWorkspace" },
  },

  // CPP — browse engine code, C++ IntelliSense, and the live build (component dev).
  {
    id: "sourceEngine",
    label: "Source engine in workspace",
    what: "A source-code O3DE engine added to this workspace — lets you read engine code and drives C++ IntelliSense. The Set Up Workspace wizard adds it alongside your project.",
    category: "engine",
    tier: "required",
    track: "cpp",
    detect: d.detectSourceEngine,
    action: { label: "Set Up Workspace…", kind: "command", payload: "o3de.setupWorkspace" },
  },
  {
    id: "visualStudio",
    label: "Visual Studio 2022 (MSVC)",
    what: "The default Windows C++ compiler + Windows SDK. Install the 'Desktop development with C++' workload.",
    category: "toolchain",
    tier: "required",
    track: "cpp",
    platforms: ["win32"],
    detect: d.detectVisualStudio,
    action: { label: "Download Visual Studio", kind: "url", payload: "https://visualstudio.microsoft.com/downloads/" },
  },
  {
    id: "gcc",
    label: "GCC",
    what: "The standard Linux C++ compiler.",
    category: "toolchain",
    tier: "required",
    track: "cpp",
    platforms: ["linux"],
    detect: d.detectGcc,
    action: { label: "Install build-essential", kind: "url", payload: "https://docs.o3de.org/docs/welcome-guide/setup/requirements/" },
  },
  {
    id: "windowsSdk",
    label: "Windows SDK",
    what: "The Windows platform headers/libraries (installed with Visual Studio's C++ workload).",
    category: "toolchain",
    tier: "required",
    track: "cpp",
    platforms: ["win32"],
    detect: d.detectWindowsSdk,
    action: { label: "Download Visual Studio", kind: "url", payload: "https://visualstudio.microsoft.com/downloads/" },
  },
  {
    id: "cmake",
    label: "CMake",
    what: "The build-system generator O3DE uses to produce the project files.",
    category: "toolchain",
    tier: "required",
    track: "cpp",
    detect: d.detectCMake,
    action: { label: "Install CMake", kind: "winget", payload: "Kitware.CMake" },
  },
  {
    id: "ninja",
    label: "Ninja",
    what: "A fast build system O3DE uses by default (Ninja Multi-Config). Standard on Linux; one click on Windows.",
    category: "toolchain",
    tier: "required",
    track: "cpp",
    detect: d.detectNinja,
    action: { label: "Install Ninja", kind: "winget", payload: "Ninja-build.Ninja" },
  },
  {
    id: "thirdParty",
    label: "3rd Party path",
    what: "The folder O3DE downloads its prebuilt 3rd-party packages into (LY_3RDPARTY_PATH). Needed to build.",
    category: "engine",
    tier: "required",
    track: "cpp",
    detect: d.detectThirdParty,
    docUrl: "https://docs.o3de.org/docs/user-guide/build/configure-and-build/",
  },
  {
    id: "cpptools",
    label: "C/C++ extension",
    what: "Microsoft's C++ language server — powers C++ completion from the config this extension generates.",
    category: "cpp",
    tier: "required",
    track: "cpp",
    detect: () => d.detectExtension("ms-vscode.cpptools"),
    action: { label: "Install C/C++", kind: "extension", payload: "ms-vscode.cpptools" },
  },

  // LUA — the Lua authoring + debugging track.
  {
    id: "sumneko",
    label: "Lua language server",
    what: "The Lua language server (sumneko.lua) — powers Lua completion from the O3DE API stubs.",
    category: "lua",
    tier: "required",
    track: "lua",
    detect: () => d.detectExtension("sumneko.lua"),
    action: { label: "Install Lua", kind: "extension", payload: "sumneko.lua" },
  },
  {
    id: "remoteToolsGem",
    label: "RemoteTools gem",
    what: "The O3DE gem that lets VS Code connect for Lua debugging and live reflection. Enable it on your project.",
    category: "lua",
    tier: "recommended",
    track: "lua",
    detect: d.detectRemoteToolsGem,
    action: { label: "Enable RemoteTools gem", kind: "enableGem", payload: "RemoteTools" },
  },
  {
    id: "reflectionDump",
    label: "Lua API data",
    what: "The reflected O3DE API dump that powers Lua completion and the palette.",
    category: "lua",
    tier: "recommended",
    track: "lua",
    detect: d.detectReflectionDump,
    action: { label: "Generate Lua IntelliSense", kind: "command", payload: "o3de.generateLuaIntelliSense" },
  },

  // OPTIONAL — available, robust, never blocking.
  {
    id: "clang",
    label: "Clang / LLVM",
    what: "An alternative C++ compiler. Optional — MSVC is the Windows default; toggle to Clang if you prefer it.",
    category: "toolchain",
    tier: "optional",
    track: "optional",
    views: ["cpp"],
    detect: d.detectClang,
    action: { label: "Install LLVM", kind: "winget", payload: "LLVM.LLVM" },
  },
  {
    id: "git",
    label: "Git",
    what: "Version control — needed to clone/update a source O3DE engine or gems.",
    category: "engine",
    tier: "recommended",
    track: "optional",
    detect: d.detectGit,
    action: { label: "Install Git", kind: "winget", payload: "Git.Git" },
  },
  {
    id: "gitLfs",
    label: "Git LFS",
    what: "Git Large File Storage — O3DE stores big binary assets with it.",
    category: "engine",
    tier: "recommended",
    track: "optional",
    detect: d.detectGitLfs,
    action: { label: "Install Git LFS", kind: "winget", payload: "GitHub.GitLFS" },
  },
  {
    id: "cmakeTools",
    label: "CMake Tools extension",
    what: "Optional CMake UI/kits for VS Code. This extension runs configure itself, so it's not required.",
    category: "cpp",
    tier: "optional",
    track: "optional",
    views: ["cpp"],
    detect: () => d.detectExtension("ms-vscode.cmake-tools"),
    action: { label: "Install CMake Tools", kind: "extension", payload: "ms-vscode.cmake-tools" },
  },
  {
    id: "python",
    label: "Python extension",
    what: "Optional — for authoring O3DE Editor Python automation scripts.",
    category: "cpp",
    tier: "optional",
    track: "optional",
    views: ["cpp"],
    detect: () => d.detectExtension("ms-python.python"),
    action: { label: "Install Python", kind: "extension", payload: "ms-python.python" },
  },
  {
    id: "longPaths",
    label: "Windows long paths",
    what: "Windows' 260-char path limit breaks O3DE builds; this enables long-path support.",
    category: "system",
    tier: "recommended",
    track: "optional",
    platforms: ["win32"],
    detect: d.detectLongPaths,
    action: { label: "Enable long paths", kind: "longpaths", payload: "" },
  },
  {
    id: "ffmpeg",
    label: "FFmpeg",
    what: "Optional — used by O3DE for some video/asset processing (the Editor warns if it's missing).",
    category: "system",
    tier: "optional",
    track: "optional",
    detect: d.detectFfmpeg,
    action: { label: "Install FFmpeg", kind: "winget", payload: "Gyan.FFmpeg" },
  },
  {
    id: "perforce",
    label: "Perforce (p4)",
    what: "Optional — Perforce source-control integration.",
    category: "system",
    tier: "optional",
    track: "optional",
    detect: d.detectPerforce,
    docUrl: "https://www.perforce.com/downloads/helix-command-line-client-p4",
  },
];

// ---- Intents (tracks the user opts into) -----------------------------------

export interface Intent {
  id: "cpp" | "lua";
  label: string;
  description: string;
}

export const INTENTS: Intent[] = [
  { id: "cpp", label: "C++ development", description: "Build the engine/gems and get C++ IntelliSense." },
  { id: "lua", label: "Lua scripting", description: "Author, run, and debug Lua game scripts." },
];

// ---- Pure roll-up helpers --------------------------------------------------

export type ResultMap = Record<string, CheckResult>;

/** Does a check apply on the given platform? (undefined platforms = all.) */
export function appliesToPlatform(check: DependencyCheck, platform: NodeJS.Platform = process.platform): boolean {
  return !check.platforms || check.platforms.includes(platform);
}

/**
 * Checks that apply given the active intents AND the platform: always base, plus
 * the chosen tracks (cpp/lua). Platform gating drops e.g. Visual Studio on Linux.
 */
export function activeChecks(
  intents: Set<Intent["id"]>,
  platform: NodeJS.Platform = process.platform,
): DependencyCheck[] {
  return CHECKS.filter(
    (c) =>
      appliesToPlatform(c, platform) &&
      (c.track === "base" || (c.track !== "optional" && intents.has(c.track as Intent["id"]))),
  );
}

/** A required check counts as blocking only if its state is missing/unknown (warn is a soft flag). */
export function isBlocking(check: DependencyCheck, result: CheckResult | undefined): boolean {
  if (check.tier !== "required") {
    return false;
  }
  const state: CheckState = result?.state ?? "unknown";
  return state === "missing" || state === "unknown";
}

/** The single next actionable required step for the chosen intents (or null when the ramp is complete). */
export function nextStep(
  results: ResultMap,
  intents: Set<Intent["id"]>,
  platform: NodeJS.Platform = process.platform,
): DependencyCheck | null {
  return activeChecks(intents, platform).find((c) => isBlocking(c, results[c.id])) ?? null;
}

/** Is the ramp for the chosen intents complete (all required base + track checks satisfied)? */
export function rampComplete(
  results: ResultMap,
  intents: Set<Intent["id"]>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return nextStep(results, intents, platform) === null;
}

/** Count required-satisfied / required-total for the active ramp (for a progress read-out). */
export function rampProgress(
  results: ResultMap,
  intents: Set<Intent["id"]>,
  platform: NodeJS.Platform = process.platform,
): { done: number; total: number } {
  const required = activeChecks(intents, platform).filter((c) => c.tier === "required");
  const done = required.filter((c) => !isBlocking(c, results[c.id])).length;
  return { done, total: required.length };
}

// ---- Sub-reports (top-level "Ready" = necessities; per-track + optionals) ---

/** How many optional dependencies are present vs. total (available on this platform). */
export function optionalsSummary(
  results: ResultMap,
  platform: NodeJS.Platform = process.platform,
): { present: number; total: number } {
  const opt = CHECKS.filter((c) => c.track === "optional" && appliesToPlatform(c, platform));
  const present = opt.filter((c) => (results[c.id]?.state ?? "unknown") === "ok").length;
  return { present, total: opt.length };
}

export interface Readiness {
  base: boolean; // project + engine only — the bare necessity
  cpp: boolean; // C++ track ready (base + toolchain + cpptools)
  lua: boolean; // Lua track ready (base + language server + dump pieces)
  optionals: { present: number; total: number };
}

/** The dashboard read-out: base "Ready" plus independent C++/Lua sub-reports + optionals. */
export function readiness(results: ResultMap, platform: NodeJS.Platform = process.platform): Readiness {
  return {
    base: rampComplete(results, new Set(), platform),
    cpp: rampComplete(results, new Set(["cpp"]), platform),
    lua: rampComplete(results, new Set(["lua"]), platform),
    optionals: optionalsSummary(results, platform),
  };
}

// ---- Render model (for the guided Onboarding UI) ---------------------------

export interface CheckView {
  id: string;
  label: string;
  what: string;
  state: CheckState;
  detail?: string;
  tier: Tier;
  track: Track;
  category: Category;
  actionLabel?: string;
  isNext: boolean;
}

export type View = "cpp" | "lua";

export interface OnboardingModel {
  view: View; // which track the sub-interface is showing/editing
  readiness: Readiness; // base + BOTH tracks' status (always shown)
  next?: { id: string; label: string; what: string; actionLabel: string };
  ramp: CheckView[]; // base + the viewed track, in ramp order
  optionals: CheckView[]; // optional extras relevant to the viewed track
}

/**
 * Everything the dashboard needs for ONE track view — a radio switcher, not an
 * additive filter. The ramp = base + the viewed track; optionals are filtered to
 * that track (Lua doesn't list Clang). Readiness still reports both tracks so the
 * user always sees the full-package status.
 */
export function buildOnboardingModel(
  results: ResultMap,
  view: View,
  platform: NodeJS.Platform = process.platform,
): OnboardingModel {
  const intents = new Set<Intent["id"]>([view]);
  const next = nextStep(results, intents, platform);
  const toView = (c: DependencyCheck): CheckView => ({
    id: c.id,
    label: c.label,
    what: c.what,
    state: results[c.id]?.state ?? "unknown",
    detail: results[c.id]?.detail,
    tier: c.tier,
    track: c.track,
    category: c.category,
    actionLabel: c.action?.label,
    isNext: next?.id === c.id,
  });
  return {
    view,
    readiness: readiness(results, platform),
    next: next
      ? { id: next.id, label: next.label, what: next.what, actionLabel: next.action?.label ?? "Fix" }
      : undefined,
    ramp: activeChecks(intents, platform).map(toView),
    optionals: CHECKS.filter(
      (c) => c.track === "optional" && appliesToPlatform(c, platform) && (!c.views || c.views.includes(view)),
    ).map(toView),
  };
}

/** Look up a check's guided action by id (for the dashboard action dispatch). */
export function actionFor(id: string): GuidedAction | undefined {
  return CHECKS.find((c) => c.id === id)?.action;
}
