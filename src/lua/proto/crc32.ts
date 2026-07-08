// ============================================================================
//  AZ::Crc32 — O3DE's string/byte hashing.
//
//  O3DE hashes with the standard zlib/PKZIP CRC-32 (polynomial 0xEDB88320),
//  but the STRING overload (used for service keys and every reflected message
//  command code) lowercases the input first. So AZ_CRC("Foo") == AZ_CRC("foo").
//
//  The engine truth: Code/Framework/AzCore/AzCore/Math/Crc32.* + CrcInternal.h.
//  We keep this dependency-free (npm crc packages don't reproduce the exact
//  AZ values, per the reference implementation's notes — see NOTICE.md).
// ============================================================================

// Standard zlib CRC-32 lookup table (polynomial 0xEDB88320, reflected).
const CRC_TABLE: Uint32Array = buildTable();

function buildTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

// ---- Public API ------------------------------------------------------------

/** CRC-32 of a raw byte range, matching AZ::Crc32(const void*, size_t). */
export function crc32Bytes(bytes: Uint8Array): number {
  if (bytes.length === 0) {
    return 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** CRC-32 of a string, matching AZ_CRC / AZ::Crc32(const char*): ASCII-lowercased. */
export function crc32(text: string): number {
  return crc32Bytes(new TextEncoder().encode(text.toLowerCase()));
}
