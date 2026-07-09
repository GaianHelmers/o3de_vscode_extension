// ============================================================================
//  AZ::ObjectStream — binary (ST_BINARY) encode/decode.
//
//  The remote-tools payload is one serialized message object in ObjectStream's
//  self-describing tag-length-value binary format (version 3). Engine truth:
//  Code/Framework/AzCore/AzCore/Serialization/ObjectStream.cpp.
//
//  Stream = [u8 tag=0x00][u32 version=3] <root element> [u8 END(header)].
//  Element = [u8 flags]
//            [u32 nameCrc      if HAS_NAME]
//            [u8  version      if HAS_VERSION]
//            [16  type Uuid]                         (always)
//            [size field + value bytes  if HAS_VALUE]
//            <child elements...>
//            [u8 END]                                (always closes an element)
//
//  All integers are big-endian. A leaf primitive still gets a trailing END, so
//  every element is read the same way: header, then children until END.
//
//  Algorithm reference: lumbermixalot/vscode-dbg-ext-o3de-lua (MIT), reworked
//  into a registry-driven tree here. See NOTICE.md.
// ============================================================================

import { ByteReader, ByteWriter } from "./binary";
import { crc32 } from "./crc32";
import { ClassData, registry } from "./registry";
import { bytesToUuid, uuidToBytes } from "./uuid";

// ---- Binary element flags (ObjectStream.cpp) -------------------------------
const FLAG_VALUE_SIZE_MASK = 0x07; // low 3 bits: inline value size, or width of the size field
const FLAG_ELEMENT_HEADER = 1 << 3;
const FLAG_HAS_VALUE = 1 << 4;
const FLAG_EXTRA_SIZE_FIELD = 1 << 5;
const FLAG_HAS_NAME = 1 << 6;
const FLAG_HAS_VERSION = 1 << 7;
const FLAG_ELEMENT_END = 0x00;

const STREAM_TAG_BINARY = 0x00;
const STREAM_VERSION = 3;

// A decoded value: primitive leaf, string, container array, or named fields.
export type AzValue = number | bigint | boolean | string | AzValue[] | AzObject;
export interface AzObject {
  [field: string]: AzValue;
}

const ELEMENT_NAME_CRC = crc32("element"); // container item field name

// ---- Encode ----------------------------------------------------------------

/** Serialize a message object (by its class Uuid) to an ObjectStream binary blob. */
export function encodeObjectStream(uuid: string, value: AzValue): Uint8Array {
  const w = new ByteWriter(256);
  w.u8(STREAM_TAG_BINARY).u32(STREAM_VERSION);
  writeNode(w, uuid, 0, value);
  w.u8(FLAG_ELEMENT_END); // end-of-header (Finalize)
  return w.toBuffer();
}

function writeNode(w: ByteWriter, uuid: string, nameCrc: number, value: AzValue): void {
  const cd = registry.find(uuid);
  const kind = registry.kind(cd);

  const raw =
    kind === "string" ? new TextEncoder().encode(String(value ?? "")) :
    kind === "primitive" ? primitiveToBytes(cd, value) :
    // Opaque leaf (e.g. AZ::Uuid): a compound with no reflected fields carrying a
    // raw value we decoded to a Uuid/hex string — write those bytes back.
    kind === "compound" && cd.elements.length === 0 && typeof value === "string" && value ? hexToBytes(value) :
    null;

  let flags = FLAG_ELEMENT_HEADER;
  if (nameCrc) {
    flags |= FLAG_HAS_NAME;
  }
  if (cd.version) {
    flags |= FLAG_HAS_VERSION;
  }

  let sizeFieldWidth = 0;
  if (raw) {
    flags |= FLAG_HAS_VALUE;
    if (raw.length < FLAG_VALUE_SIZE_MASK + 1) {
      flags |= raw.length; // fits inline in the low 3 bits (0..7)
    } else {
      flags |= FLAG_EXTRA_SIZE_FIELD;
      sizeFieldWidth = raw.length < 0x100 ? 1 : raw.length < 0x10000 ? 2 : 4;
      flags |= sizeFieldWidth;
    }
  }

  w.u8(flags);
  if (nameCrc) {
    w.u32(nameCrc);
  }
  if (cd.version) {
    w.u8(cd.version);
  }
  w.bytes(uuidToBytes(uuid));

  if (raw) {
    if (sizeFieldWidth === 1) {
      w.u8(raw.length);
    } else if (sizeFieldWidth === 2) {
      w.u16(raw.length);
    } else if (sizeFieldWidth === 4) {
      w.u32(raw.length);
    }
    if (raw.length) {
      w.bytes(raw);
    }
  }

  if (kind === "container") {
    const items = (value as AzValue[]) ?? [];
    const elemUuid = cd.containerTypes[0];
    for (const item of items) {
      writeNode(w, elemUuid, ELEMENT_NAME_CRC, item);
    }
  } else if (kind === "compound") {
    const obj = (value as AzObject) ?? {};
    for (const el of cd.elements) {
      // Base classes are nested elements fed from the same flat field object.
      writeNode(w, el.uuid, el.nameCrc, el.isBaseClass ? obj : obj[el.name]);
    }
  }

  w.u8(FLAG_ELEMENT_END);
}

function primitiveToBytes(cd: ClassData, value: AzValue): Uint8Array {
  const out = new Uint8Array(cd.typeSize);
  const view = new DataView(out.buffer);
  const n = typeof value === "boolean" ? (value ? 1 : 0) : value;
  switch (cd.typeSize) {
    case 1:
      view.setUint8(0, Number(n) & 0xff);
      break;
    case 2:
      view.setUint16(0, Number(n) & 0xffff);
      break;
    case 4:
      view.setUint32(0, Number(n) >>> 0);
      break;
    case 8:
      view.setBigUint64(0, BigInt(n as number | bigint));
      break;
    default:
      throw new Error(`Unsupported primitive size ${cd.typeSize} for ${cd.name}`);
  }
  return out;
}

// ---- Decode ----------------------------------------------------------------

export interface DecodedMessage {
  uuid: string;
  value: AzValue;
}

/** Parse an ObjectStream binary blob into { uuid, value } (value shaped per class). */
export function decodeObjectStream(bytes: Uint8Array): DecodedMessage {
  const r = new ByteReader(bytes);
  const tag = r.u8();
  const version = r.u32();
  if (tag !== STREAM_TAG_BINARY) {
    throw new Error(`Expected binary ObjectStream tag 0x00, got 0x${tag.toString(16)}`);
  }
  if (version !== STREAM_VERSION) {
    throw new Error(`Unexpected ObjectStream version ${version} (expected ${STREAM_VERSION})`);
  }
  const root = readNode(r);
  if (!root) {
    throw new Error("Empty ObjectStream: no root element");
  }
  return { uuid: root.uuid, value: root.value };
}

interface DecodedNode {
  uuid: string;
  nameCrc: number;
  value: AzValue;
}

function readNode(r: ByteReader): DecodedNode | null {
  const flags = r.u8();
  if (flags === FLAG_ELEMENT_END) {
    return null;
  }
  if (!(flags & FLAG_ELEMENT_HEADER)) {
    throw new Error(`Malformed ObjectStream: expected element header, got flags 0x${flags.toString(16)}`);
  }

  const nameCrc = flags & FLAG_HAS_NAME ? r.u32() : 0;
  if (flags & FLAG_HAS_VERSION) {
    r.u8(); // element version — unused by these messages
  }
  const uuid = bytesToUuid(r.take(16));
  const cd = registry.has(uuid) ? registry.find(uuid) : undefined;

  let raw: Uint8Array | null = null;
  if (flags & FLAG_HAS_VALUE) {
    let size: number;
    if (flags & FLAG_EXTRA_SIZE_FIELD) {
      const width = flags & FLAG_VALUE_SIZE_MASK;
      size = width === 1 ? r.u8() : width === 2 ? r.u16() : r.u32();
    } else {
      size = flags & FLAG_VALUE_SIZE_MASK;
    }
    raw = size > 0 ? r.take(size) : new Uint8Array(0);
  }

  if (!cd) {
    // Unknown type (FILTERFLAG_IGNORE_UNKNOWN_CLASSES on the engine side): skip
    // its subtree so the parse stays aligned.
    while (readNode(r)) {
      /* drain children */
    }
    return { uuid, nameCrc, value: {} };
  }

  const kind = registry.kind(cd);
  const children: DecodedNode[] = [];
  for (let child = readNode(r); child; child = readNode(r)) {
    children.push(child);
  }

  let value: AzValue;
  if (kind === "container") {
    value = children.map((c) => c.value);
  } else if (kind === "compound" && cd.elements.length === 0 && raw && raw.length > 0) {
    // Opaque leaf with no reflected sub-fields but a raw value — e.g. AZ::Uuid
    // (16 bytes). Model as a Uuid string (or hex) so typeIds survive.
    value = raw.length === 16 ? bytesToUuid(raw) : hex(raw);
  } else if (kind === "compound") {
    const obj: AzObject = {};
    for (const child of children) {
      const el = cd.elements.find((e) => e.nameCrc === child.nameCrc);
      if (!el) {
        continue;
      }
      if (el.isBaseClass) {
        Object.assign(obj, child.value as AzObject); // flatten base fields up
      } else {
        obj[el.name] = child.value;
      }
    }
    value = obj;
  } else if (kind === "string") {
    value = raw && raw.length ? new TextDecoder().decode(raw) : "";
  } else {
    value = primitiveFromBytes(cd, raw);
  }

  return { uuid, nameCrc, value };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Parse a Uuid ("{8-4-4-4-12}") or plain hex string back into bytes.
function hexToBytes(text: string): Uint8Array {
  const digits = text.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(digits.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(digits.substr(i * 2, 2), 16);
  }
  return out;
}

function primitiveFromBytes(cd: ClassData, raw: Uint8Array | null): AzValue {
  if (!raw || raw.length === 0) {
    return cd.name === "bool" ? false : 0;
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  switch (cd.typeSize) {
    case 1:
      return cd.name === "bool" ? view.getUint8(0) !== 0 : view.getUint8(0);
    case 2:
      return view.getUint16(0);
    case 4:
      return view.getUint32(0);
    case 8:
      return view.getBigUint64(0);
    default:
      throw new Error(`Unsupported primitive size ${cd.typeSize} for ${cd.name}`);
  }
}
