"""
Dump O3DE's reflected Lua API to JSON, for the VS Code extension's Lua IntelliSense.

Runs inside the O3DE Editor's Python (azlmbr). It drives the AzToolsFramework
LuaSymbolsReporterBus (module "script", Automation scope) — the same reflection
data the built-in Lua IDE shows — and writes it to JSON.

Invoked by the extension via:  Editor --runpython dump_lua_symbols.py
Output path is taken from the O3DE_LUA_SYMBOLS_OUT environment variable, or falls
back to <project>/user/lua_symbols.json.

Verified against LuaSymbolsReporterBus.h:
  GetListOfClasses -> [{name, typeId, properties:[{name,canRead,canWrite}],
                       methods:[{name,debugArgumentInfo}]}]
  GetListOfGlobalProperties -> [{name,canRead,canWrite}]
  GetListOfGlobalFunctions  -> [{name,debugArgumentInfo}]
  GetListOfEBuses -> [{name,canBroadcast,canQueue,hasHandler,
                       senders:[{name,debugArgumentInfo,category}]}]
"""

import json
import os

import azlmbr.bus as bus
import azlmbr.script as script


DUMP_VERSION = 1


def _prop(p):
    return {"name": str(p.name), "canRead": bool(p.canRead), "canWrite": bool(p.canWrite)}


def _method(m):
    return {"name": str(m.name), "debugArgumentInfo": str(m.debugArgumentInfo)}


def _class(c):
    return {
        "name": str(c.name),
        "typeId": str(c.typeId),
        "properties": [_prop(p) for p in c.properties],
        "methods": [_method(m) for m in c.methods],
    }


def _sender(s):
    return {
        "name": str(s.name),
        "debugArgumentInfo": str(s.debugArgumentInfo),
        "category": str(s.category),
    }


def _ebus(e):
    return {
        "name": str(e.name),
        "canBroadcast": bool(e.canBroadcast),
        "canQueue": bool(e.canQueue),
        "hasHandler": bool(e.hasHandler),
        "senders": [_sender(s) for s in e.senders],
    }


def _call(event_name):
    # LuaSymbolsReporterBus is a single-address broadcast bus.
    return script.LuaSymbolsReporterBus(bus.Broadcast, event_name)


def main():
    out_path = os.environ.get("O3DE_LUA_SYMBOLS_OUT")
    if not out_path:
        project = os.environ.get("O3DE_PROJECT_PATH") or os.getcwd()
        out_path = os.path.join(project, "user", "lua_symbols.json")

    dump = {
        "version": DUMP_VERSION,
        "engine": os.environ.get("O3DE_ENGINE_PATH", ""),
        "project": os.environ.get("O3DE_PROJECT_PATH", ""),
        "classes": [_class(c) for c in _call("GetListOfClasses")],
        "globalProperties": [_prop(p) for p in _call("GetListOfGlobalProperties")],
        "globalFunctions": [_method(m) for m in _call("GetListOfGlobalFunctions")],
        "ebuses": [_ebus(e) for e in _call("GetListOfEBuses")],
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(dump, f, indent=2)

    print(
        "[o3de-lua] wrote {} classes, {} EBuses, {} globals, {} global properties to {}".format(
            len(dump["classes"]),
            len(dump["ebuses"]),
            len(dump["globalFunctions"]),
            len(dump["globalProperties"]),
            out_path,
        )
    )


def _quit_editor():
    # A --runpython Editor does NOT exit on its own; ask it to close so the
    # headless dump doesn't linger. Best-effort across engine versions — the
    # extension also polls for the output file and kills the process as a backstop.
    try:
        import azlmbr.legacy.general as general
        if hasattr(general, "exit_no_prompt"):
            general.exit_no_prompt()
        elif hasattr(general, "exit"):
            general.exit()
    except Exception as ex:  # noqa: BLE001 - never let cleanup fail the dump
        print("[o3de-lua] could not auto-exit the Editor: {}".format(ex))


if __name__ == "__main__":
    main()
    _quit_editor()
