// ============================================================================
//  O3DE code snippets — deployed into <project>/.vscode/O3DEDevSnippets.code-snippets.
//
//  Common O3DE C++ patterns (TickBus, reflection, EBus scaffold, printf). Written
//  WRITE-IF-ABSENT: never clobbers a snippets file the user has customized.
// ============================================================================

import * as fs from "fs";
import * as path from "path";

const SNIPPETS_FILE = "O3DEDevSnippets.code-snippets";

/** The bundled O3DE snippet set (JSON object keyed by snippet name). */
export const O3DE_SNIPPETS: Record<string, unknown> = {
  "Queue Function": {
    prefix: "QueueFunction",
    body: ["AZ::TickBus::QueueFunction([this]()", "{", "});"],
    description: "Create blank queue function.",
  },
  Tick_Header: {
    prefix: "OnTick_Header",
    body: ["//TickBus", "void OnTick(float deltaTime, AZ::ScriptTimePoint time) override;", "//"],
    description: "Add a TickBus OnTick Header.",
  },
  Reflection_DataElement: {
    prefix: "DataElement",
    body: ['->DataElement(AZ::Edit::UIHandlers::Default, &, "Variable", "description.")'],
    description: "Add a Data Element line to Reflection.",
  },
  Reflection_Field: {
    prefix: "Field",
    body: ['->Field("VARNAME", &COMP::VAR)'],
    description: "Add a Field line to Reflection.",
  },
  Print: {
    prefix: "Print",
    body: ['AZ_Printf("", "");'],
    description: "Add a Print Line.",
  },
  MaybeUnused: {
    prefix: "Maybe_Unused",
    body: ["[[maybe_unused]]"],
    description: "Add a maybe unused flag.",
  },
  EventClass: {
    prefix: "EventClass",
    body: [
      "class COMPONENTRequests",
      "    : public AZ::EBusTraits",
      "{",
      "public:",
      "    using Bus = AZ::EBus<COMPONENTRequests>;",
      "    using BusIdType = AZ::EntityId;                 // Addressed by EntityId",
      "    static const AZ::EBusAddressPolicy AddressPolicy = AZ::EBusAddressPolicy::ById;",
      "    static const AZ::EBusHandlerPolicy HandlerPolicy = AZ::EBusHandlerPolicy::Multiple;  // Multiple listeners",
      "};",
      "using COMPONENTRequestBus = AZ::EBus<COMPONENTRequests>;",
    ],
    description: "Add an event bus class.",
  },
  GroupAndLabel: {
    prefix: "ReflectGroup",
    body: [
      '->ClassElement(AZ::Edit::ClassElements::Group, "Identifier Group")',
      "    ->Attribute(AZ::Edit::Attributes::AutoExpand, true)",
      "    ->Attribute(AZ::Edit::Attributes::ContainerCanBeModified, false)",
      '    ->Attribute(AZ::Edit::Attributes::NameLabelOverride, "")',
      '    ->Attribute(AZ::Edit::Attributes::ValueText, "<h3>LabelText</h3>")',
    ],
    description: "Add a group and label to Reflection.",
  },
};

/** Write the snippets into <project>/.vscode/ if not already present. Returns true if written. */
export function writeSnippetsIfAbsent(projectPath: string): boolean {
  const dir = path.join(projectPath, ".vscode");
  const file = path.join(dir, SNIPPETS_FILE);
  if (fs.existsSync(file)) {
    return false; // never clobber a user-customized snippets file
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(O3DE_SNIPPETS, null, 4)}\n`, "utf8");
  return true;
}
