# O3DE Engine PR Spec — Carry reflection **Category** over the Script Debug bridge

**Audience:** O3DE engine contributors (this is an upstream-engine change, not a VS Code
extension change).
**Goal:** Make the semantic **Category** of each reflected class / global / EBus available to
remote Script-Debug consumers (the built-in Lua IDE *and* the VS Code "O3DE Development Tools"
extension), so a Lua API browser can group symbols the way Script Canvas's Node Palette does.

---

## 1. Problem statement

The Script Debug bridge enumerates the Lua-registered API and ships it to a remote tool via
`ScriptDebugRegisteredClassesResult` / `…GlobalsResult` / `…EBusesResult`. Those payloads carry
**name, typeId, methods, properties** — but **no category** for classes or globals. The only
`category` on the wire today is on EBus *senders*, and it is the sender *kind*
(`"Event"` / `"Broadcast"` / `"Notification"`), not a semantic group.

As a result, every remote browser (the Lua IDE's Class Reference, and our VS Code Lua Palette)
can only present a **flat** `Classes / EBuses / Globals` tree. Script Canvas's Node Palette, by
contrast, presents a **nested category tree** (e.g. `Gameplay/Camera`, `Math/Vector`) because it
reads reflection **in-process** and has access to the `BehaviorContext` attributes the wire
never carries.

### Where the category actually lives

`AZ::Script::Attributes::Category` is a `BehaviorContext` attribute on each `BehaviorClass` /
`BehaviorMethod` / `BehaviorEBus`. Script Canvas reads it directly:

```
// Gems/ScriptCanvas/Code/Editor/View/Widgets/NodePalette/NodePaletteModel.cpp
AZStd::string GetCategoryPath(const AZ::AttributeArray& attributes, const AZ::BehaviorContext& bc)
{
    AZStd::string retVal;
    if (AZ::Attribute* categoryAttribute = AZ::FindAttribute(AZ::Script::Attributes::Category, attributes))
    {
        AZ::AttributeReader(nullptr, categoryAttribute).Read<AZStd::string>(retVal, bc);
    }
    return retVal; // "" when the class declares no Category
}
```

The category is a **path** using `/` as the separator; consumers split it to build the tree.
When empty, Script Canvas buckets the symbol under a default (`"Class Methods"`, `"Events"`,
`"Event Handlers"`, `"Global Methods"`, `"Global Constants"`).

### Why the wire can't get it today

The enumeration path is:

```
ScriptContextDebug::EnumRegisteredClasses(enumClass, enumMethod, enumProperty, userData)
   → invokes  enumClass(className, typeId, userData)         // no category
```

`ScriptContextDebug` walks the Lua VM's class table and **already holds the `BehaviorClass`
pointer** at the call site (it reads `AZ::Script::Attributes::ExcludeFrom` off it a few lines
earlier), but it never forwards the Category to the callback. So the category is *right there*
and simply not passed on.

---

## 2. Design — inject at the shared AzCore choke point

There is exactly **one** place to read the category so that **both** transports benefit:
`AZ::ScriptContextDebug::EnumRegisteredClasses`. It already has the `BehaviorClass` in hand.

```
Code/Framework/AzCore/AzCore/Script/ScriptContextDebug.cpp : EnumRegisteredClasses()
   line ~139  BehaviorClass* behaviorClass = ...              // already have it
   line ~141  behaviorClass->FindAttribute(ExcludeFrom)       // already reading attributes here
   line ~157  enumClass(className, behaviorClass->m_typeId, userData)   // ← add category here
```

**Blast radius is tiny.** Only two call sites consume this AzCore API:

| Caller | File | Transport |
|---|---|---|
| `ScriptDebugAgent` | `Code/Framework/AzFramework/AzFramework/Script/ScriptRemoteDebugging.cpp` | RemoteTools wire (Lua IDE + VS Code live scrape) |
| `LuaSymbolsReporterSystemComponent` | `Code/Framework/AzToolsFramework/AzToolsFramework/Script/LuaSymbolsReporterSystemComponent.cpp` | Headless JSON dump (VS Code offline IntelliSense) |

(The `Code/Tools/LuaIDE/**` matches for `EnumRegisteredClasses` are *message-name* references,
not calls to the AzCore API — they don't change.)

> **Alternative (lower AzCore churn):** leave the `EnumClass` typedef alone and have each of the
> two consumers do its own `BehaviorContext` lookup by typeId
> (`AZ::ComponentApplicationBus → GetBehaviorContext()`, then
> `behaviorContext->m_typeToClassMap[typeId]->FindAttribute(Category)`). This avoids touching a
> public AzCore signature but duplicates the lookup in two components. **Recommended path is the
> choke point** below — it's cleaner and the signature is only consumed twice.

---

## 3. Change set

### Part A — AzCore: forward the category from the choke point *(shared)*

**`Code/Framework/AzCore/AzCore/Script/ScriptContextDebug.h`**

Extend the `EnumClass` callback typedef to pass the category path:

```cpp
// before
typedef bool(*EnumClass)(const char* /*class Name*/, const AZ::Uuid& /*class TypeId*/, void* /*userdata*/);
// after
typedef bool(*EnumClass)(const char* /*class Name*/, const AZ::Uuid& /*class TypeId*/,
                         const char* /*category path, "" if none*/, void* /*userdata*/);
```

**`Code/Framework/AzCore/AzCore/Script/ScriptContextDebug.cpp`** — in `EnumRegisteredClasses`,
read the Category off the `behaviorClass` already loaded at line ~139 and pass it at line ~157:

```cpp
AZStd::string category; // path form, e.g. "Gameplay/Camera"
if (AZ::Attribute* categoryAttr = behaviorClass->FindAttribute(AZ::Script::Attributes::Category))
{
    AZ::AttributeReader(nullptr, categoryAttr).Read<AZStd::string>(category, *m_context.GetBehaviorContext());
}

if (!enumClass(lua_tostring(l, -1), behaviorClass->m_typeId, category.c_str(), userData))
{
    lua_pop(l, 5);
    return;
}
```

> `AZ::Script::Attributes::Category` is reflected as `AZStd::string` in most gems but as
> `const char*` in some. `AttributeReader::Read<AZStd::string>` handles both. Keep the read
> defensive — a failed read leaves `category` empty, which is the correct "uncategorized" signal.

*(Optional, same choke point: `EnumRegisteredEBuses` and `EnumRegisteredGlobals` can forward a
class/bus-level Category the same way — see §5.)*

### Part B — AzFramework: wire struct + serialization + agent population

**`Code/Framework/AzFramework/AzFramework/Script/ScriptRemoteDebugging.h`** — add the field
(`m_` prefix per O3DE style; on-disk field string stays unprefixed):

```cpp
struct ScriptUserClassInfo
{
    AZ_TYPE_INFO(ScriptUserClassInfo, "{08b32f99-2ea2-4abe-a05f-1aa32ef44b15}");
    AZStd::string           m_name;
    AZ::Uuid                m_typeId;
    AZStd::string           m_category;   // NEW — path form, "" if uncategorized
    ScriptUserMethodList    m_methods;
    ScriptUserPropertyList  m_properties;
};
```

**`Code/Framework/AzFramework/AzFramework/Script/ScriptDebugMsgReflection.cpp`** — reflect the
new field (string un-prefixed, pointer prefixed):

```cpp
serializeContext->Class<ScriptUserClassInfo>()
    ->Field("name",       &ScriptUserClassInfo::m_name)
    ->Field("type",       &ScriptUserClassInfo::m_typeId)
    ->Field("category",   &ScriptUserClassInfo::m_category)   // NEW
    ->Field("methods",    &ScriptUserClassInfo::m_methods)
    ->Field("properties", &ScriptUserClassInfo::m_properties);
```

**`Code/Framework/AzFramework/AzFramework/Script/ScriptRemoteDebugging.cpp`** — the `EnumClass`
callback gains the parameter and stores it:

```cpp
static bool EnumClass(const char* name, const AZ::Uuid& typeId, const char* category, void* userData)
{
    ScriptUserClassList& output = *reinterpret_cast<ScriptUserClassList*>(userData);
    auto& c = output.emplace_back();
    c.m_name = name;
    c.m_typeId = typeId;
    c.m_category = category ? category : "";   // NEW
    return true;
}
```

### Part C — AzToolsFramework: mirror on the headless reporter

The headless JSON dump uses a parallel struct. Keep it consistent so the offline and live paths
produce the same shape.

**`Code/Framework/AzToolsFramework/AzToolsFramework/Script/LuaSymbolsReporterBus.h`**

```cpp
struct AZTF_API LuaClassSymbol
{
    AZ_TYPE_INFO(LuaClassSymbol, "{5FBE5841-A8E1-44B6-BEDA-22302CF8DF5F}");
    AZStd::string               m_name;
    AZ::Uuid                    m_typeId;
    AZStd::string               m_category;   // NEW
    AZStd::vector<LuaPropertySymbol> m_properties;
    AZStd::vector<LuaMethodSymbol>   m_methods;
    AZStd::string ToString() const;
};
```

**`…/LuaSymbolsReporterSystemComponent.cpp`**

- In `LuaClassSymbol::Reflect` (BehaviorContext block), add
  `->Property("category", BehaviorValueProperty(&LuaClassSymbol::m_category))`.
- In `GetListOfClasses`, the `enumClassFunc` lambda gains the `const char* category` parameter
  and assigns `classSymbol.m_category = category ? category : "";`.

---

## 4. Wire / version compatibility

These Script-Debug structs are reflected **without `->Version()`** (verified: zero `Version(`
calls in `ScriptDebugMsgReflection.cpp`). AZ ObjectStream tags every field by the CRC of its
element name, so an **additive** field is safe in both directions:

| Sender → Receiver | Behavior |
|---|---|
| **New agent → old debugger** | Old reader encounters an unknown `"category"` element and **skips** it. No break. |
| **Old agent → new debugger** | New reader finds no `"category"` element; `m_category` **defaults to `""`** → treated as uncategorized. No break. |

No version bump is required, and no CRC/enum/message-type changes are needed — the
`EnumRegisteredClasses` request and `ScriptDebugRegisteredClassesResult` response types are
unchanged. **Do not** add a `->Version()` to these classes as part of this PR; introducing a
version where there was none changes the stream framing and would break existing peers.

---

## 5. Optional scope extensions (recommend including)

For full Script-Canvas-parity grouping, the same treatment applies to:

- **Global methods / properties** — `BehaviorMethod` / `BehaviorProperty` carry
  `Script::Attributes::Category` too. Forward it through `EnumRegisteredGlobals`'
  `EnumMethod`/`EnumProperty` callbacks (add a `const char* category` param) and add
  `m_category` to `ScriptUserMethodInfo` / `ScriptUserPropertyInfo`.
- **EBus (bus-level) category** — `BehaviorEBus` carries a class-level Category distinct from the
  per-sender kind. Forward it via `EnumRegisteredEBuses`' `EnumEBus` callback and add
  `m_category` to `ScriptUserEBusInfo`. (Leave the existing per-sender
  `ScriptUserEBusMethodInfo::m_category` — the Event/Broadcast/Notification kind — untouched.)

Each is the identical additive pattern as §3 and independently compatible.

---

## 6. Data shape the VS Code extension consumes

The extension already decodes these messages; it will read the new fields with **no protocol
renames**. Field-name contract (must match exactly — the decoder keys on these strings):

| Struct | New field string | Type | Meaning |
|---|---|---|---|
| `ScriptUserClassInfo` | `"category"` | string | `/`-delimited path; `""` = uncategorized |
| `ScriptUserMethodInfo` *(opt §5)* | `"category"` | string | global-method category |
| `ScriptUserEBusInfo` *(opt §5)* | `"category"` | string | bus-level category |

Headless JSON dump (`user/lua_symbols.json`) mirror — `_class()` emits:

```json
{ "name": "TransformBus", "typeId": "{…}", "category": "Gameplay/Transform",
  "properties": [ … ], "methods": [ … ] }
```

**Consumer rules the extension will apply** (documented so the engine side and tool agree):
- `category` is a path; split on `/` to build nested groups.
- Empty/absent → default bucket by symbol kind (Classes / EBuses / Globals), preserving today's
  flat behavior for un-annotated symbols and for pre-change engines.

---

## 7. Files-to-touch checklist

- [ ] `Code/Framework/AzCore/AzCore/Script/ScriptContextDebug.h` — `EnumClass` typedef (+ optionally `EnumMethod`/`EnumProperty`/`EnumEBus`).
- [ ] `Code/Framework/AzCore/AzCore/Script/ScriptContextDebug.cpp` — read `Script::Attributes::Category` in `EnumRegisteredClasses` (+ optional globals/ebuses).
- [ ] `Code/Framework/AzFramework/AzFramework/Script/ScriptRemoteDebugging.h` — `ScriptUserClassInfo::m_category` (+ optional).
- [ ] `Code/Framework/AzFramework/AzFramework/Script/ScriptRemoteDebugging.cpp` — populate in `EnumClass` (+ optional callbacks).
- [ ] `Code/Framework/AzFramework/AzFramework/Script/ScriptDebugMsgReflection.cpp` — `->Field("category", …)` (+ optional).
- [ ] `Code/Framework/AzToolsFramework/AzToolsFramework/Script/LuaSymbolsReporterBus.h` — `LuaClassSymbol::m_category` (+ optional).
- [ ] `Code/Framework/AzToolsFramework/AzToolsFramework/Script/LuaSymbolsReporterSystemComponent.cpp` — reflect + populate.

## 8. Verification

1. **Live wire:** attach the Lua IDE (or the VS Code extension's live scrape) to a running
   Editor; confirm `ScriptDebugRegisteredClassesResult` classes now carry a non-empty
   `category` for classes that declare one (e.g. Script-Canvas-exposed math/gameplay types) and
   `""` for those that don't.
2. **Headless dump:** run the reporter path; confirm `user/lua_symbols.json` classes include the
   `"category"` key.
3. **Back-compat:** point a **new** debugger at an **old**-agent Editor (and vice-versa) →
   enumeration still succeeds, category simply empty. Confirms the additive-field contract.
4. **No regression:** existing Lua IDE Class Reference still populates (it ignores the new
   field until updated to use it).

## 9. Open questions for reviewers

1. **Choke point vs. consumer-side lookup** (§2) — is changing the `EnumClass` typedef
   acceptable, or do you prefer each consumer resolve the `BehaviorContext` itself to keep the
   AzCore callback signature frozen?
2. **`Category` type inconsistency** — some reflections use `const char*`, others `AZStd::string`.
   `AttributeReader::Read<AZStd::string>` covers both; confirm no gem relies on a non-string
   Category.
3. **Scope** — land classes-only first (§3), or include globals + bus-level categories (§5) in
   the same PR?
