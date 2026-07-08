// ============================================================================
//  AZ::Uuid wire form.
//
//  On the wire a Uuid is 16 raw bytes in canonical (RFC-4122) left-to-right
//  order — the same order they appear in the textual "{XXXXXXXX-XXXX-...}" form
//  (AZ stores them big-endian internally; see AzCore/Math/Uuid.cpp). So the
//  conversion is a straight hex read/write with the braces and dashes skipped.
// ============================================================================

/** "{11E0E012-BD54-...}" (any case) → canonical uppercase key with braces. */
export function normalizeUuid(uuid: string): string {
  return uuid.toUpperCase();
}

/** Parse the 32 hex digits out of a "{...}" Uuid string into 16 bytes. */
export function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 32) {
    throw new Error(`Invalid Uuid string: ${uuid}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** 16 bytes → canonical uppercase "{8-4-4-4-12}" string. */
export function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, "0").toUpperCase());
  }
  const s = hex.join("");
  return `{${s.substr(0, 8)}-${s.substr(8, 4)}-${s.substr(12, 4)}-${s.substr(16, 4)}-${s.substr(20, 12)}}`;
}
