# Changelog

All notable changes to the **O3DE Development Tools** extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.1] — 2026-07-10

A UX v2 pass that reorganizes the dashboard around how the tools are actually used, plus new
build/scripting controls and a broader, clearer onboarding.

### Added

- **Core Count** build option — set the parallel job count passed to `cmake --build --parallel N`
  (blank/0 = auto). Threaded through the interactive, headless, and LLM build paths.
- **Lua Palette live search** — the palette is now a panel with a docked search bar that filters
  the Classes / EBuses / Globals tree as you type (instant, per-frame rendering); clicking a symbol
  still inserts its call snippet.
- **Version Control** onboarding section — Git, Git LFS, and Perforce, plus new **Subversion** and
  **Plastic SCM (Unity Version Control)** detectors.
- **Re-runnable onboarding steps** — already-satisfied checks that can meaningfully be re-run now
  offer a button to do so: **Source engine** (Re-run) and **Workspace settings** (Rewrite) confirm
  first; **LLM connections** reports its live status.
- **Register VS Code as Lua Editor** is now a self-detecting Lua onboarding requirement (reads the
  `.setreg` it writes) with a **Re-register** action once set.
- **Add Gems / Folders** — restored as a dashboard action, and its picker gains a **Show built-in
  gems** toggle so the engine's built-in gems stay out of the way until you want them.

### Changed

- **Dashboard reorganized** — the single "Configuration" area is split into **C++** and **Lua**
  sections (each: everyday actions first, then configuration), alongside **Setup & Onboarding**.
  Section collapse state now persists across VS Code restarts.
- **Onboarding reformatted** — reads top-down as **Status → Required → Common Optionals →
  C++/Lua switcher → that track's requirements & optionals → Version Control**. Re-scan moved into
  the section header beside the status light.
- **Class Creation Wizard** moved into **Utilities** as a discreet full-width button.
- **Utilities icons** — Editor Log (document), Error Log (error), and Run in Debug (bug) are compact
  icon buttons; Run in Debug moved out of the Build & Run row.
- The dashboard view is titled **Dashboard** again (the panel header carries the name + version).

### Removed

- The redundant **Open Lua Palette** and **Write Workspace Settings** buttons from the config
  sections (the palette is a view; Write Workspace Settings is an onboarding step).
- The Lua Palette title-bar filter/clear commands — filtering is now the inline search bar.

## [0.0.15] — 2026-07-09

A follow-up pass resolving reported issues across build, run, Lua tooling, and onboarding.

### Added

- **Run in Debug (C++)** — launch the Editor / GameLauncher under VS Code's C++ debugger
  (`cppvsdbg`) straight from the tooling window: a keybindable command plus a debug caret next
  to **Run**. The launch is configured for you — no hand-edited `launch.json`.
- **Compiler selection** — choose **MSVC** or **Clang**; the choice flows into the CMake
  configure (Clang via `-T ClangCl` on the VS generator, or the Clang compiler flags on Ninja).
- **Class Creation Wizard** — launch the engine-side `Tools/ClassCreationWizard` PySide tool
  from the dashboard, wired to the active engine and project.
- **Lua Palette search** — filter the Classes / EBuses / Globals tree by name; matching
  containers auto-expand, and a clear-filter action resets it.

### Changed

- **Write Workspace Settings** — the former *Write Project Config* action is renamed and now
  treated as a required setup step (writes `.vscode/settings.json` CMake keys).
- Build and Configure reuse their named terminals instead of stacking new ones on every run.
- `.lua` files no longer surface C++ word-based suggestions — completion is LuaLS-only.
- The reflection-dump / RemoteTools status refreshes on panel focus and after a dump, with a
  manual **Re-scan** button, so it no longer shows stale results.

## [0.0.14] — 2026-07-09

The first Marketplace update since 0.0.2 — a major feature drop that adds full **Lua
development** support and a **guided onboarding** system on top of the build, run, and C++
foundation.

### Added — Lua development

- **Lua debugger** — a native Debug Adapter that speaks O3DE's RemoteTools protocol directly
  (no companion gem or helper process): breakpoints, step in/over/out, continue, call stack,
  locals, watch, and edit-value, against a running Editor or GameLauncher.
- **Lua IntelliSense** — generates LuaLS (sumneko) annotation stubs from O3DE's reflected
  scripting API for typed completion and hovers in `.lua` scripts. Reflection data can be
  scraped **live from a running Editor** (no boot) or from a **headless** Editor run.
- **Lua Function Palette** — a browsable, searchable Classes / EBuses / Globals tree in the
  O3DE activity bar (the VS Code equivalent of the built-in Lua Editor's Class Reference),
  with click-to-insert.
- **Editor handoff** — O3DE's *Open Lua Editor* (Tools menu and the Script component's Edit
  button) opens scripts in VS Code via a `vscode://` URI; new scripts open as unsaved buffers.
- A getting-started guide covering authoring, attaching a script to an entity, running it, and
  debugging with breakpoints.

### Added — Guided onboarding

- **Intent-driven setup ramp** — choose **C++** or **Lua**; the panel shows just that track's
  requirements, computes the single next step, and offers one-click acquisition (install /
  enable / configure) for every missing dependency.
- **Exhaustive, platform-aware dependency detection** — compiler (MSVC / Clang), CMake, Ninja,
  Windows SDK, engine, project, 3rd-Party path, Git / Git LFS, the C++ and Lua language-server
  extensions, the RemoteTools gem, and more (Windows / Linux).
- Per-track **Ready** sub-reports (C++ / Lua) in the panel header; Build & Run stay enabled on
  the bare minimum (a project) regardless of track readiness.
- The active extension version is shown in the O3DE panel title.

### Included — Build, run & C++ foundation

- Guided multi-root workspace setup (project + engine source + gems).
- Windows MSVC environment bootstrap; Ninja detection and install.
- One-click CMake configure / build / run with selectable generator, config, and targets.
- C++ IntelliSense via the CMake File API (cpptools), with engine-source path resolution.

## [0.0.2] — 2026-07-01

- Early preview: extension skeleton, MSVC environment, initial workspace/build scaffolding.
