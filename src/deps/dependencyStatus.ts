// ============================================================================
//  Dependency status — runs the registry's detectors, caches results, and holds
//  the user's chosen intents (C++ / Lua). The guided Onboarding ramp reads its
//  results + roll-ups; a background refresh keeps them current and fires change.
// ============================================================================

import * as vscode from "vscode";
import { CheckResult } from "./detectors";
import { CHECKS, Readiness, ResultMap, View, readiness } from "./registry";

const KEY_RESULTS = "o3de.deps.results";
const KEY_VIEW = "o3de.deps.view";

export class DependencyStatus {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private results: ResultMap;
  private currentView: View;

  constructor(private readonly state: vscode.Memento) {
    this.results = state.get<ResultMap>(KEY_RESULTS) ?? {};
    this.currentView = state.get<View>(KEY_VIEW) ?? "cpp";
  }

  // ---- Accessors -----------------------------------------------------------

  get resultMap(): ResultMap {
    return this.results;
  }

  resultFor(id: string): CheckResult | undefined {
    return this.results[id];
  }

  /** Which track the setup sub-interface is showing (radio: C++ or Lua). */
  get view(): View {
    return this.currentView;
  }

  async setView(view: View): Promise<void> {
    this.currentView = view;
    await this.state.update(KEY_VIEW, view);
    this.changed.fire();
  }

  /** Base "Ready" + independent C++/Lua sub-reports + optionals count (for the dashboard). */
  get readiness(): Readiness {
    return readiness(this.results);
  }

  // ---- Detection -----------------------------------------------------------

  /** Re-run every detector (in parallel), cache, and fire change if anything moved. */
  async refresh(): Promise<void> {
    const entries = await Promise.all(
      CHECKS.map(async (c): Promise<[string, CheckResult]> => {
        try {
          return [c.id, await c.detect()];
        } catch {
          return [c.id, { state: "unknown" }];
        }
      }),
    );

    const next: ResultMap = {};
    for (const [id, result] of entries) {
      next[id] = result;
    }

    if (JSON.stringify(next) !== JSON.stringify(this.results)) {
      this.results = next;
      await this.state.update(KEY_RESULTS, next);
      this.changed.fire();
    }
  }

  dispose(): void {
    this.changed.dispose();
  }
}
