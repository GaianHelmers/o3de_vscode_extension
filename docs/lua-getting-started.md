# O3DE Lua in VS Code — Getting Started & Verification

A step-by-step guide to authoring, running, and debugging an O3DE Lua script from VS Code —
written for people **new to Lua**. Follow it top to bottom once to confirm everything works.

> Everything below is driven from the **O3DE Development Tools** panel (the O3DE icon in the
> activity bar) → **Configuration → Lua** section, or the Command Palette (`Ctrl+Shift+P`, type "O3DE").

---

## Prerequisites

- The **[Lua language server](https://marketplace.visualstudio.com/items?itemName=sumneko.lua)**
  (`sumneko.lua`) installed in VS Code — this provides the completion/hover.
- A **built, non-Release** O3DE Editor for your project (Debug or Profile), with the **RemoteTools**
  gem enabled (the default in O3DE's standard project templates). Debugging needs this; authoring does not.

---

## 1. One-time setup

**a. Make VS Code the Lua editor** (so O3DE's *Open Lua Editor* comes here):
Lua → **Register VS Code as Lua Editor**, pick a scope, then **restart the O3DE Editor** once.

**b. Generate IntelliSense** (the reflected O3DE API → typed completion):
Lua → **Generate Lua IntelliSense**. The first run launches the Editor headless and takes a few minutes;
it writes `<project>/user/lua_symbols.json` and the stubs under `.vscode/o3de-lua-stubs/`. When it
finishes you'll see a "…classes, EBuses, globals" notification. *(Already have a dump? Use **Generate
Stubs From Dump** — instant.)*

---

## 2. Author a script

Lua → **New Lua Script** → choose **Bobbing sample**. This opens a **fresh, unsaved** buffer (it isn't
written anywhere yet) with a small script that moves an entity up and down and logs on activate — perfect
for verifying everything. The **Lua Palette** opens beside it.

**Save it into your project**: `Ctrl+S` → save as e.g. `Scripts/Bobbing.lua` **inside your project
folder** (so the Asset Processor compiles it). You can save anywhere, but a Script component can only use
scripts under the project.

---

## 3. Attach the script to an entity (in the O3DE Editor)

This is the O3DE side — the part that isn't obvious if you're new:

1. In the Editor, create an entity: **right-click the viewport → Create entity** (or use the Entity Outliner).
2. With the entity selected, in the **Entity Inspector** click **Add Component → Scripting → Lua Script**.
3. In the Lua Script component, set the **Script** property to your `Bobbing.lua` (browse to it).
4. Give the entity a visible **Mesh** component too (e.g. a cube) so you can see it move. Place it where
   you can see it.

The Asset Processor compiles `.lua` → `.luac` automatically when you save; give it a second.

---

## 4. Run it

Press **Ctrl+G** to enter **Game Mode**. You should see:
- the entity **bobbing up and down**, and
- a line in the Editor **Console** (open with the `~` key): `O3DE Lua sample: OnActivate on entity …`.

Press **Esc** to exit Game Mode. If it moved and logged — authoring + the reflected API work. ✅

---

## 5. Debug it with breakpoints

1. Open `Bobbing.lua` in VS Code.
2. Click in the gutter to the left of the **`local height = …`** line to set a **breakpoint** (red dot).
3. Click **Debug Lua File** — the ▷ button in the editor's title bar (top-right). The status bar shows the
   debugger waiting, then attached once the Editor connects.
4. Back in the O3DE Editor, press **Ctrl+G** to enter Game Mode. VS Code should **break** on your line.
5. Inspect:
   - **Run and Debug → Variables**: expand to see `self`, `deltaTime`, `height`.
   - **Call Stack** shows where you are.
   - **Step Over (F10)**, **Step Into (F11)**, **Continue (F5)**.
6. Press **Continue** to let it run; it will break again next frame. Stop debugging (the red square) or
   disconnect when done.

> While stopped at a breakpoint the **whole O3DE Editor freezes** — that's expected and by design; the
> engine pauses at the breakpoint. It resumes when you Continue.

If the breakpoint hits and you can inspect variables — debugging works. ✅

---

## 6. IntelliSense & the palette

- In the script, type `Transform` — you should get completion, and hovering a method shows its signature.
- Open the **Lua Palette** (O3DE activity bar → *Lua Palette*): browse **Classes / EBuses / Globals**,
  and click any entry to **insert** it into the script at your cursor.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| *Open Lua Editor* in O3DE does nothing | Launch the O3DE Editor **not** from a VS Code terminal (env inheritance breaks the handoff); and make sure VS Code and the Editor run at the **same** elevation. |
| No completions | Install `sumneko.lua`; run **Generate Lua IntelliSense**; then **Developer: Reload Window**. |
| Palette empty | Run **Generate Lua IntelliSense** first (it produces the data the palette reads), then the palette's refresh button. |
| Breakpoint never hits | Editor/Launcher must be a **non-Release** build with the **RemoteTools** gem; the script must be on an **active** entity; you must be in **Game Mode**; only one debugger at a time (close the built-in Lua IDE). |
| "Scanning reflected Lua API…" never finishes | A cold headless Editor boot takes a few minutes the first time; it finishes as soon as the dump file is written. |
| Script doesn't move the entity | Confirm the entity has a Mesh, the Script property points at your `.lua`, and the Asset Processor compiled it (check for errors in the AP window). |

---

*The reflected O3DE API is a property of the running engine, so the completion data comes from a dump of
your built Editor. Regenerate it when you add gems or change the reflected API.*
