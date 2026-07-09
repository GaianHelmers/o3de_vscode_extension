# Changelog

All notable changes to the **O3DE Development Tools** extension are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
