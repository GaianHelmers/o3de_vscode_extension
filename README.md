# O3DE Development Tools

A developer companion for [Open 3D Engine (O3DE)](https://o3de.org) in Visual Studio Code.

> 🧪 **Early / experimental.** Scope and features are actively evolving. Windows-focused (MSVC).

Everything is driven from a single **O3DE Development Tools** panel in the activity bar: a Dashboard
with live status, Build/Run, utilities, and collapsible Configuration & Onboarding sections.

## Features

- **Guided workspace setup** — assemble the multi-root workspace (project + engine source + gems)
  into a `.code-workspace`, with `.vscode` settings generated for you.
- **Windows MSVC environment** — auto-detects Visual Studio, opens a developer terminal with the
  MSVC environment established; detects Ninja and offers to install it.
- **One-click CMake configure & build** — selectable generator, config, and target(s), mirroring
  O3DE's build flow, with a process-guard for locked build outputs.
- **Run & force-quit** — launch the Editor or the project's GameLauncher (with custom launch
  options) and stop the whole process tree (AssetProcessor and friends included).
- **C++ IntelliSense** — generates `c_cpp_properties.json` from the CMake File API and registers a
  live cpptools configuration provider; engine paths resolve to your source engine.
- **Project config generation** — `.vscode` `settings.json` + `launch.json` (Editor / GameLauncher /
  Attach / Class Creation Wizard) + O3DE code snippets.
- **Quick access** — Editor / Error logs, the extension output channel, and keybindings for Build
  (`Ctrl+Alt+B`) and Run (`Ctrl+Alt+R`).
- **Lua debugging** — a full Debug Adapter that speaks O3DE's RemoteTools protocol natively (no
  companion gem): breakpoints, stepping, call stack, locals, watch, and edit-value, against a
  running Editor or GameLauncher. Plus an **"Open in VS Code" handoff** so the Editor's *Tools ▸ Lua
  Editor* and a Script component's *Edit* button open scripts here.

### Debugging Lua

1. Run **O3DE: Register VS Code as Lua Editor** once (writes `/O3DE/Lua/Debugger/Uri` into your
   project's registry). Restart the Editor. Now "Open Lua Editor" in O3DE opens the script here.
2. Open a `.lua` file, set breakpoints, and click **Debug Lua File** (the ▷ in the editor title bar)
   or press F5 with the *O3DE: Attach to Lua* configuration.
3. Start your game (Editor Game Mode, or the GameLauncher). It connects to VS Code automatically and
   breakpoints hit.

Requires a **non-Release** Editor/Launcher build with the **RemoteTools gem** enabled (the default in
O3DE's standard project templates). Debugging is localhost-only, one target at a time.

## Planned features

- **Lua** completion & IntelliSense driven by O3DE reflection (LuaLS annotation stubs).
- **Reflection browser** — inspect reflected components, EBuses, and the BehaviorContext.
- **Templates & a Class Creation Wizard** (components, EBuses, gems).
- Broader cross-platform support.

## Requirements

Windows with **Visual Studio 2022** (Desktop development with C++), **CMake**, and optionally
**Ninja**, plus a registered O3DE project and engine. The extension's Onboarding panel checks these
for you and helps fill the gaps.

## Development

Prerequisites: **Node.js** (npm). For building O3DE itself you also need
**Visual Studio 2022** (Desktop C++), **CMake**, and (optionally) **Ninja**.

```bash
npm install        # install dependencies
npm run compile    # type-check + bundle to dist/extension.js
```

### Run / debug the extension (F5)

1. Open this folder in VS Code.
2. Press **F5** (Run → Start Debugging) — this runs the **"Run Extension"** config,
   which builds first, then launches a second VS Code window: the
   **Extension Development Host**, with this extension loaded.
3. In that window open the Command Palette (**Ctrl+Shift+P**) and run
   **"O3DE: Hello World"** — a notification confirms the extension is live.
4. Edit code, then use **Ctrl+Shift+F5** (Restart) in the host, or relaunch, to reload.

For continuous rebuilds while iterating, run the **watch** task (`npm run watch`) in a terminal.

### Scripts

| Command | Purpose |
|---|---|
| `npm run compile` | Type-check and bundle to `dist/` |
| `npm run watch` | Incremental rebuild on save |
| `npm run lint` | ESLint over `src/` |
| `npm test` | Run the extension test suite (downloads a test VS Code build on first run) |
| `npm run package` | Production bundle (used by `vsce` when packaging a `.vsix`) |

### Packaging a shareable build

```bash
npx vsce package   # produces o3de-development-tools-<version>.vsix
```

Install a `.vsix` locally via **Extensions view → ⋯ → Install from VSIX…**, or
`code --install-extension o3de-development-tools-<version>.vsix`.

## License

MIT © Genome Studios Inc

## Disclaimer

**This is an unofficial, community-built extension from Genome Studios Inc.** It is not an official
O3DE implementation, and is not affiliated with, endorsed by, or sponsored by the Open 3D Foundation
or the Linux Foundation. "O3DE", "Open 3D Engine", and the O3DE logo are trademarks of their
respective owners and are used here only to identify the engine this tool supports.
