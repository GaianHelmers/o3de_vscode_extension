// ============================================================================
//  SerializeContext class registry.
//
//  A minimal mirror of the O3DE SerializeContext entries needed to (de)serialize
//  the ScriptDebug* remote-tools messages. The data table (o3deClasses.json) is
//  vendored from lumbermixalot/vscode-dbg-ext-o3de-lua (MIT) — see NOTICE.md —
//  because it carries the SHA1-combined template UUIDs for AZStd container types
//  that cannot be hand-derived without running the engine. Verified field-for-
//  field against AzFramework/Script/ScriptDebugMsgReflection.cpp.
//
//  Each class is either:
//    - a primitive  (typeSize ≤ 8, no elements/containers)  → number/bigint/bool
//    - a string     (name starts with AZStd::…string)       → UTF-8 text
//    - a container  (containerTypes non-empty)              → array of elements
//    - a compound   (elements)                              → named fields, with
//                                                             base classes nested
// ============================================================================

import classTable from "./o3deClasses.json";
import { normalizeUuid } from "./uuid";

export interface ClassElement {
  name: string;
  nameCrc: number;
  isBaseClass: boolean;
  uuid: string;
  elementIndex: number;
}

export interface ClassData {
  name: string;
  uuid: string;
  version: number;
  containerTypes: string[];
  typeSize: number;
  elements: ClassElement[];
}

export type ClassKind = "primitive" | "string" | "container" | "compound";

class ClassRegistry {
  private readonly byUuid = new Map<string, ClassData>();

  constructor(classes: ClassData[]) {
    for (const cd of classes) {
      this.byUuid.set(normalizeUuid(cd.uuid), {
        ...cd,
        uuid: normalizeUuid(cd.uuid),
        containerTypes: cd.containerTypes.map(normalizeUuid),
        elements: cd.elements.map((e) => ({ ...e, uuid: normalizeUuid(e.uuid) })),
      });
    }
  }

  find(uuid: string): ClassData {
    const cd = this.byUuid.get(normalizeUuid(uuid));
    if (!cd) {
      throw new Error(`Unknown SerializeContext type: ${uuid}`);
    }
    return cd;
  }

  has(uuid: string): boolean {
    return this.byUuid.has(normalizeUuid(uuid));
  }

  kind(cd: ClassData): ClassKind {
    if (cd.containerTypes.length > 0) {
      return "container";
    }
    if (this.isString(cd)) {
      return "string";
    }
    if (cd.elements.length === 0 && cd.typeSize > 0 && cd.typeSize <= 8) {
      return "primitive";
    }
    return "compound";
  }

  private isString(cd: ClassData): boolean {
    return cd.name === "AZStd::string" || cd.name.startsWith("AZStd::basic_string");
  }
}

export const registry = new ClassRegistry(classTable.classes as ClassData[]);
