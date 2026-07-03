// ============================================================================
//  Build options — user-selectable build attributes shown in the O3DE tab.
//
//  Holds the current CMake generator + build config, persisted per-workspace
//  (workspaceState). The tooling view renders the current values and refreshes
//  when they change; Configure/Build/WriteConfig consume them.
// ============================================================================

import * as vscode from "vscode";

export type Generator = "Ninja Multi-Config" | "Visual Studio 17 2022";
export type BuildConfig = "profile" | "debug" | "release";

export const GENERATORS: Generator[] = ["Ninja Multi-Config", "Visual Studio 17 2022"];
export const BUILD_CONFIGS: BuildConfig[] = ["profile", "debug", "release"];

const KEY_GENERATOR = "o3de.build.generator";
const KEY_CONFIG = "o3de.build.config";

export class BuildOptions {
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires whenever a selection changes (the view listens to refresh). */
  readonly onDidChange = this.changed.event;

  constructor(private readonly state: vscode.Memento) {}

  get generator(): Generator {
    return this.state.get<Generator>(KEY_GENERATOR) ?? "Ninja Multi-Config";
  }

  get config(): BuildConfig {
    return this.state.get<BuildConfig>(KEY_CONFIG) ?? "profile";
  }

  async setGenerator(value: Generator): Promise<void> {
    await this.state.update(KEY_GENERATOR, value);
    this.changed.fire();
  }

  async setConfig(value: BuildConfig): Promise<void> {
    await this.state.update(KEY_CONFIG, value);
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }
}
