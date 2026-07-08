// End-to-end test of the RemoteTools host over a real localhost TCP socket:
// a fake "target" performs the handshake and answers an attach request, exactly
// as the O3DE Editor would. Exercises the listener, framing, packet parse, the
// chunked outbound send path, and inbound ObjectStream decode together.
import * as assert from "assert";
import * as net from "net";
import { EventEmitter } from "events";
import { RemoteToolsHost } from "../lua/debug/remoteToolsHost";
import {
  MessageReassembler,
  PacketFramer,
  PacketType,
  parseRemoteToolsMessage,
  writeRemoteToolsMessageBody,
  writeTcpHeader,
} from "../lua/proto/packets";
import { crc32 } from "../lua/proto/crc32";
import { encodeObjectStream } from "../lua/proto/objectStream";
import { ACK, CMD, MSG, asAck, parseMessage } from "../lua/proto/messages";

function onceEvent<T>(emitter: EventEmitter, event: string): Promise<T> {
  return new Promise((resolve) => emitter.once(event, (v: T) => resolve(v)));
}

function buildConnectBody(displayName: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(displayName);
  const buf = new Uint8Array(4 + 4 + 4 + 1 + nameBytes.length);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0); // capabilities
  dv.setUint32(4, crc32("LuaRemoteTools")); // persistentId
  dv.setUint32(8, displayName.length); // AZStd::string full size
  dv.setUint8(12, displayName.length); // bounded size (len ≤ 255)
  buf.set(nameBytes, 13);
  return buf;
}

suite("Lua debug host — TCP round-trip", () => {
  test("handshake, target connect, and attach ack", async function () {
    this.timeout(8000);
    const port = 6799; // avoid clashing with the real 6777
    const host = new RemoteToolsHost(port);
    let client: net.Socket | undefined;

    try {
      await new Promise<void>((resolve) => {
        host.on("listening", () => resolve());
        host.start();
      });

      client = net.connect(port, "127.0.0.1");
      await new Promise<void>((resolve) => client!.once("connect", () => resolve()));

      // Fake target: frame incoming packets; when it sees the AttachDebugger
      // request, reply with a ScriptDebugAck(AttachDebugger, Ack).
      const framer = new PacketFramer();
      const reasm = new MessageReassembler();
      let sawAttachRequest = false;
      client.on("data", (data) => {
        for (const packet of framer.push(new Uint8Array(data))) {
          if (packet.header.type !== PacketType.RemoteToolsMessage) {
            continue;
          }
          const full = reasm.add(parseRemoteToolsMessage(packet.payload));
          if (!full) {
            continue;
          }
          const msg = parseMessage(full);
          if (msg.uuid === MSG.ScriptDebugRequest && asAck(msg.obj).request === CMD.AttachDebugger) {
            sawAttachRequest = true;
            const ack = encodeObjectStream(MSG.ScriptDebugAck, {
              MsgId: BigInt(crc32("ScriptDebugger")),
              request: CMD.AttachDebugger,
              ackCode: ACK.Ack,
            });
            const body = writeRemoteToolsMessageBody(crc32("LuaRemoteTools"), ack, ack.length);
            client!.write(Buffer.from(writeTcpHeader(PacketType.RemoteToolsMessage, body.length)));
            client!.write(Buffer.from(body));
          }
        }
      });

      // Target dials in: InitiateConnection (empty) then RemoteToolsConnect.
      client.write(Buffer.from(writeTcpHeader(PacketType.InitiateConnection, 0)));
      const connectBody = buildConnectBody("Editor.exe");
      client.write(Buffer.from(writeTcpHeader(PacketType.RemoteToolsConnect, connectBody.length)));
      client.write(Buffer.from(connectBody));

      const displayName = await onceEvent<string>(host, "targetConnected");
      assert.strictEqual(displayName, "Editor.exe");

      const attachedPromise = onceEvent<void>(host, "attached");
      host.attach("Default");
      await attachedPromise;

      assert.ok(sawAttachRequest, "target should have received the AttachDebugger request");
      assert.ok(host.isAttached, "host should report attached");
    } finally {
      client?.destroy();
      host.stop();
    }
  });
});
