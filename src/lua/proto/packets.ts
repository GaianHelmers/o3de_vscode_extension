// ============================================================================
//  AzNetworking TCP framing + RemoteTools packets.
//
//  Wire = repeated [ 5-byte TCP header ][ payload ]. Header (big-endian):
//     u8  flags   (bit0 = Compressed; unused here)
//     u16 type    (packet type id)
//     u16 size    (payload byte count, excluding the header)
//  Engine truth: AzNetworking/TcpTransport/TcpPacketHeader.* and the AutoPackets
//  in Gems/RemoteTools/Code/Source/AutoGen/RemoteTools.AutoPackets.xml.
//
//  Payloads are serialized with AzNetworking's ISerializer (big-endian). We only
//  need three packet types: InitiateConnection (1, handshake), RemoteToolsConnect
//  (7, target announces itself), RemoteToolsMessage (8, carries an ObjectStream
//  blob, possibly chunked). Chunk cap = MaxPacketSize(16384) - 384 = 16000.
//
//  Framing/layout adapted from lumbermixalot/vscode-dbg-ext-o3de-lua (MIT); the
//  RemoteToolsMessage size prefix follows the engine's ByteBuffer<16000>
//  serializer (u16 + u16), verified against AzNetworking ByteBuffer.inl. See NOTICE.md.
// ============================================================================

import { ByteReader, ByteWriter } from "./binary";

export const TCP_HEADER_SIZE = 5;

export enum PacketType {
  InitiateConnection = 1,
  RemoteToolsConnect = 7,
  RemoteToolsMessage = 8,
}

/** Max ObjectStream bytes carried by a single RemoteToolsMessage packet. */
export const REMOTE_TOOLS_CHUNK_MAX = 16384 - 384;

export interface TcpHeader {
  flags: number;
  type: number;
  size: number; // payload size, header excluded
}

export function readTcpHeader(bytes: Uint8Array): TcpHeader {
  const r = new ByteReader(bytes);
  return { flags: r.u8(), type: r.u16(), size: r.u16() };
}

export function writeTcpHeader(type: number, payloadSize: number): Uint8Array {
  return new ByteWriter(TCP_HEADER_SIZE).u8(0).u16(type).u16(payloadSize).toBuffer();
}

// ---- RemoteToolsConnect (target → us) --------------------------------------

export interface RemoteToolsConnect {
  capabilities: number;
  persistentId: number;
  displayName: string;
}

export function parseRemoteToolsConnect(payload: Uint8Array): RemoteToolsConnect {
  const r = new ByteReader(payload);
  const capabilities = r.u32();
  const persistentId = r.u32();
  const displayName = readAzNetString(r);
  return { capabilities, persistentId, displayName };
}

// An AZStd::string over AzNetworking's ISerializer: [u32 fullSize]
// [bounded length in RequiredBytes(fullSize) bytes][UTF-8 bytes]. The bounded
// width is 1 byte for lengths ≤ 255, else 2 (we never see larger display names).
function readAzNetString(r: ByteReader): string {
  const fullSize = r.u32();
  const boundedWidth = fullSize <= 0xff ? 1 : 2;
  const bounded = boundedWidth === 1 ? r.u8() : r.u16();
  if (bounded !== fullSize) {
    throw new Error(`AzNetworking string length mismatch: ${fullSize} vs ${bounded}`);
  }
  return new TextDecoder().decode(r.take(fullSize));
}

// ---- RemoteToolsMessage (both directions) ----------------------------------

export interface RemoteToolsMessageChunk {
  chunk: Uint8Array; // this packet's slice of the full ObjectStream blob
  totalSize: number; // total reassembled size across all chunks
  persistentId: number;
}

/**
 * Body layout per the engine ByteBuffer<16000> + uint32 fields:
 *   [u16 chunkSize][u16 chunkSize(again)][chunk bytes][u32 totalSize][u32 persistentId]
 */
export function parseRemoteToolsMessage(payload: Uint8Array): RemoteToolsMessageChunk {
  const r = new ByteReader(payload);
  const chunkSize = r.u16();
  const chunkSize2 = r.u16();
  if (chunkSize !== chunkSize2) {
    throw new Error(`RemoteToolsMessage chunk size mismatch: ${chunkSize} vs ${chunkSize2}`);
  }
  const chunk = new Uint8Array(r.take(chunkSize));
  const totalSize = r.u32();
  const persistentId = r.u32();
  return { chunk, totalSize, persistentId };
}

export function writeRemoteToolsMessageBody(
  persistentId: number,
  chunk: Uint8Array,
  totalSize: number,
): Uint8Array {
  const w = new ByteWriter(chunk.length + 12);
  w.u16(chunk.length).u16(chunk.length).bytes(chunk).u32(totalSize).u32(persistentId);
  return w.toBuffer();
}

// ---- Stream framing --------------------------------------------------------

export interface Packet {
  header: TcpHeader;
  payload: Uint8Array;
}

/**
 * Accumulates raw TCP bytes and yields complete packets. TCP gives no message
 * boundaries, so we buffer until a full 5-byte header plus its declared payload
 * has arrived, then emit and repeat.
 */
export class PacketFramer {
  private pending: Uint8Array = new Uint8Array(0);

  push(data: Uint8Array): Packet[] {
    this.pending = concat(this.pending, data);
    const packets: Packet[] = [];
    while (this.pending.length >= TCP_HEADER_SIZE) {
      const header = readTcpHeader(this.pending.subarray(0, TCP_HEADER_SIZE));
      const total = TCP_HEADER_SIZE + header.size;
      if (this.pending.length < total) {
        break; // wait for the rest of this packet
      }
      const payload = new Uint8Array(this.pending.subarray(TCP_HEADER_SIZE, total));
      packets.push({ header, payload });
      this.pending = new Uint8Array(this.pending.subarray(total));
    }
    return packets;
  }
}

/** Reassembles multi-packet RemoteToolsMessages into whole ObjectStream blobs. */
export class MessageReassembler {
  private chunks: Uint8Array[] = [];
  private accumulated = 0;
  private expected = 0;

  /** Feed one chunk; returns the full blob when complete, else null. */
  add(part: RemoteToolsMessageChunk): Uint8Array | null {
    if (this.chunks.length === 0) {
      this.expected = part.totalSize;
    }
    this.chunks.push(part.chunk);
    this.accumulated += part.chunk.length;
    if (this.accumulated < this.expected) {
      return null;
    }
    const full = concatAll(this.chunks);
    this.chunks = [];
    this.accumulated = 0;
    this.expected = 0;
    return full;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function concatAll(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
