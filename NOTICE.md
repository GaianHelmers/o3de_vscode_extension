# Third-Party Notices

## vscode-dbg-ext-o3de-lua (MIT)

Portions of the O3DE Lua remote-debugging support in this extension are derived
from **[lumbermixalot/vscode-dbg-ext-o3de-lua](https://github.com/lumbermixalot/vscode-dbg-ext-o3de-lua)**
by Galib F. Arrieta ("lumbermixalot"), used under the MIT License. The full
license text is in [`third_party/LICENSE.vscode-dbg-ext-o3de-lua.txt`](third_party/LICENSE.vscode-dbg-ext-o3de-lua.txt).

What is derived:

- **`src/lua/proto/o3deClasses.json`** — vendored largely as-is. This is the
  SerializeContext class-layout table for the ScriptDebug message types. It
  carries the SHA1-combined template UUIDs for AZStd container types, which
  cannot be hand-derived without running the O3DE engine. Verified field-for-field
  against `AzFramework/Script/ScriptDebugMsgReflection.cpp`.

- **`src/lua/proto/objectStream.ts`, `packets.ts`, `crc32.ts`** — the AZ::ObjectStream
  binary format, AzNetworking TCP framing, and AZ::Crc32 algorithm were
  cross-checked against the reference implementation, then reworked into
  registry-driven modules here. The RemoteToolsMessage size-prefix encoding
  follows the O3DE engine's `ByteBuffer<16000>` serializer (u16 + u16) verified
  against `AzNetworking/DataStructures/ByteBuffer.inl`.

All other O3DE protocol facts were independently extracted from the O3DE engine
source (Apache-2.0). See `.serena/memories/lua_support/luaide_integration_reference.md`.
