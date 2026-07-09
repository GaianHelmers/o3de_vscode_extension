// ============================================================================
//  New Lua script — open a fresh, UNSAVED Lua buffer (untitled).
//
//  We deliberately do NOT create a file in a predetermined location. Opening the
//  Lua editor with no file gives you a blank, pliable buffer with the whole Lua
//  environment staged (palette + IntelliSense); you save when ready and choose
//  where. This suits Lua-only authors who touch no C++ and no fixed project layout.
//
//  Templates are verified against a real O3DE reflection dump: `log`,
//  `TickBus.Connect`, `TransformBus.Event.Get/SetWorldTranslation`, `Vector3`.
// ============================================================================

import * as vscode from "vscode";
import { LUA_PALETTE_VIEW_ID } from "./palette/luaPaletteProvider";

// ---- Templates -------------------------------------------------------------

const COMPONENT_TEMPLATE = `local MyComponent = {
    Properties = {
        -- Reflected properties show up in the entity's Lua Script component.
        -- Example:  Speed = { default = 1.0, description = "Movement speed" },
    },
}

function MyComponent:OnActivate()
    -- Runs when the entity becomes active (e.g. entering Game Mode).
end

function MyComponent:OnDeactivate()
    -- Runs when the entity is deactivated. Disconnect any bus handlers here.
end

return MyComponent
`;

// A self-demonstrating sample: bobs the entity up and down every frame and logs
// on activate. Good for verifying IntelliSense, the palette, and breakpoints.
const SAMPLE_TEMPLATE = `local BobbingSample = {
    Properties = {
        Height = { default = 1.0, description = "How far the entity bobs up and down (metres)." },
        Speed = { default = 2.0, description = "Bobbing speed." },
    },
}

function BobbingSample:OnActivate()
    -- Runs when the entity becomes active (entering Game Mode).
    log("O3DE Lua sample: OnActivate on entity " .. tostring(self.entityId))
    self.elapsed = 0.0
    self.startPos = TransformBus.Event.GetWorldTranslation(self.entityId)
    self.tickBusHandler = TickBus.Connect(self)
end

function BobbingSample:OnTick(deltaTime, timePoint)
    -- Runs every frame. Set a BREAKPOINT on the "height" line below, then inspect
    -- height, deltaTime and self in the Run and Debug > Variables panel.
    self.elapsed = self.elapsed + deltaTime
    local height = math.sin(self.elapsed * self.Properties.Speed) * self.Properties.Height
    local pos = Vector3(self.startPos.x, self.startPos.y, self.startPos.z + height)
    TransformBus.Event.SetWorldTranslation(self.entityId, pos)
end

function BobbingSample:OnDeactivate()
    if self.tickBusHandler ~= nil then
        self.tickBusHandler:Disconnect()
    end
end

return BobbingSample
`;

// ---- Open an untitled Lua buffer + stage the environment -------------------

async function openUntitledLua(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: "lua", content });
  await vscode.window.showTextDocument(doc, { preview: false });
  // Stage the authoring environment: reveal the function palette alongside.
  void vscode.commands.executeCommand(`${LUA_PALETTE_VIEW_ID}.focus`);
}

/** Command: pick a template and open it as a fresh unsaved Lua buffer. */
export async function newLuaScript(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: "$(file) Blank", detail: "An empty Lua buffer.", content: "" },
      { label: "$(symbol-class) Component", detail: "OnActivate / OnDeactivate skeleton.", content: COMPONENT_TEMPLATE },
      {
        label: "$(debug-alt) Bobbing sample",
        detail: "Moves the entity + logs — great for testing IntelliSense, the palette, and breakpoints.",
        content: SAMPLE_TEMPLATE,
      },
    ],
    { title: "New O3DE Lua Script", placeHolder: "Start from…" },
  );
  if (!pick) {
    return;
  }
  await openUntitledLua(pick.content);
}

/**
 * Open the default Lua component template as a fresh UNSAVED buffer — used when
 * O3DE opens the editor with no file. It's our predetermined default content,
 * just not written anywhere yet; the user saves (and picks a location) when ready.
 */
export async function openDefaultLuaScript(): Promise<void> {
  await openUntitledLua(COMPONENT_TEMPLATE);
}
