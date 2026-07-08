// ============================================================================
//  Lua debug registration — adapter factory + configuration provider.
//
//  The adapter runs in-process (DebugAdapterInlineImplementation) so there is no
//  separate process to spawn. The configuration provider fills in the project
//  root and port for zero-config "Debug File" launches.
// ============================================================================

import * as vscode from "vscode";
import { detectProjectRoot, findProjectRoot } from "../projectPaths";
import { LUA_TOOLS_PORT } from "./remoteToolsHost";
import { LuaDebugSession } from "./luaDebugSession";

export const LUA_DEBUG_TYPE = "o3de-lua";

class LuaDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(new LuaDebugSession());
  }
}

class LuaConfigurationProvider implements vscode.DebugConfigurationProvider {
  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // Zero-config F5 on a .lua file: synthesize an attach config.
    if (!config.type && !config.request && !config.name) {
      config.type = LUA_DEBUG_TYPE;
      config.request = "attach";
      config.name = "O3DE: Debug Lua";
    }

    if (!config.projectPath) {
      const active = vscode.window.activeTextEditor?.document.uri.fsPath;
      config.projectPath =
        (active && findProjectRoot(active)) ??
        (folder && findProjectRoot(folder.uri.fsPath)) ??
        detectProjectRoot();
    }
    if (!config.projectPath) {
      void vscode.window.showErrorMessage(
        "O3DE Lua debug: could not locate a project.json. Open your O3DE project folder.",
      );
      return undefined;
    }
    if (!config.port) {
      config.port = LUA_TOOLS_PORT;
    }
    return config;
  }
}

export function registerLuaDebug(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(LUA_DEBUG_TYPE, new LuaDebugAdapterFactory()),
    vscode.debug.registerDebugConfigurationProvider(LUA_DEBUG_TYPE, new LuaConfigurationProvider()),
  );
}

/** Start an attach session for the given file's project (used by "Debug Lua File"). */
export async function debugLuaFile(fileUri?: vscode.Uri): Promise<void> {
  const target = fileUri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    void vscode.window.showErrorMessage("O3DE Lua debug: no Lua file is active.");
    return;
  }
  const projectPath = findProjectRoot(target.fsPath) ?? detectProjectRoot();
  if (!projectPath) {
    void vscode.window.showErrorMessage("O3DE Lua debug: could not locate a project.json for this file.");
    return;
  }
  const folder = vscode.workspace.getWorkspaceFolder(target);
  await vscode.debug.startDebugging(folder, {
    type: LUA_DEBUG_TYPE,
    request: "attach",
    name: "O3DE: Debug Lua",
    projectPath,
    port: LUA_TOOLS_PORT,
  });
}
