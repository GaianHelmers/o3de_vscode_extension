// ============================================================================
//  Select Build Targets — the multi-select picker behind Build Options ▸ Targets.
//
//  Curated targets (Editor, <Project>.GameLauncher) are pinned first, then every
//  real target from the CMake File API reply (type-to-filter) so the user can
//  build one feature/gem. Currently-selected names always appear (custom picks
//  survive), plus a "Custom target(s)…" entry for names not yet in the tree.
//  Checking NONE stores an empty set — the Build command then builds everything.
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import { BuildOptions } from "./buildOptions";
import { resolveWorkspaceProject } from "./projectResolve";
import { fileApiReplyDir } from "./configureCommand";
import { curatedTargets, parseCustomTargets } from "./buildCommand";
import { loadTargetNames } from "../intellisense/fileApi";

const CUSTOM_ITEM_LABEL = "$(edit) Custom target(s)…";

interface TargetItem extends vscode.QuickPickItem {
  target?: string; // the CMake target name (absent on the custom / separator rows)
}

// ---- Assemble the ordered, de-duplicated candidate list --------------------
/** Curated first → File-API targets → any current selection not already listed. */
function orderCandidates(curated: string[], apiTargets: string[], current: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of [...curated, ...apiTargets, ...current]) {
    if (!seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  }
  return ordered;
}

// ---- Command ---------------------------------------------------------------
export async function selectTargets(options: BuildOptions): Promise<void> {
  const project = await resolveWorkspaceProject("O3DE: Build Targets");
  if (!project) {
    return;
  }

  const curated = curatedTargets(project.projectName);
  const replyDir = fileApiReplyDir(project.path);
  const apiTargets = fs.existsSync(replyDir) ? loadTargetNames(replyDir, options.config) : [];

  const current = new Set(options.targets);
  const ordered = orderCandidates(curated, apiTargets, options.targets);
  const curatedSet = new Set(curated);

  const items: TargetItem[] = ordered.map((name) => ({
    label: name,
    target: name,
    picked: current.has(name),
    description: curatedSet.has(name) ? "common" : undefined,
  }));
  items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: CUSTOM_ITEM_LABEL });

  const picks = await vscode.window.showQuickPick(items, {
    title: "O3DE: Build Targets",
    canPickMany: true,
    placeHolder: apiTargets.length
      ? "Check target(s) to build — check NONE to build everything"
      : "Check target(s) — run Configure to list all targets; NONE = build everything",
  });
  if (!picks) {
    return; // cancelled — leave the selection unchanged
  }

  let chosen = picks.filter((p) => p.target !== undefined).map((p) => p.target as string);

  // The "Custom target(s)…" row opens an input box for names not in the tree.
  if (picks.some((p) => p.label === CUSTOM_ITEM_LABEL)) {
    const typed = await vscode.window.showInputBox({
      title: "O3DE: Custom Build Target(s)",
      prompt: "CMake target name(s), separated by spaces or commas",
      placeHolder: "e.g. MyGem.Static  MyGem.Editor",
    });
    if (typed) {
      chosen = [...new Set([...chosen, ...parseCustomTargets(typed)])];
    }
  }

  await options.setTargets(chosen);
}
