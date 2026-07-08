# O3DE Development Tools

A developer companion for [Open 3D Engine (O3DE)](https://o3de.org) in Visual Studio Code.

> ⚠️ **Early / experimental.** Scope and features are actively evolving.

## Planned features

- Windows **MSVC environment bootstrap** for integrated terminals & build tasks
- Reliable **CMake configure / build / launch** (Editor, GameLauncher) with correct targets
- Full **C++ IntelliSense** for O3DE (wiring cpptools / clangd to the build)
- **Lua** completion & IntelliSense driven by O3DE reflection
- **Templates & a Class Creation Wizard** (components, EBuses, gems)

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

MIT © Genome Studios
