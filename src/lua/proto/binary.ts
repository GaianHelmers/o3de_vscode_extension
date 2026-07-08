// ============================================================================
//  Binary read/write cursors — big-endian, matching O3DE's serializers.
//
//  Both AzNetworking's ISerializer and AZ::ObjectStream's binary format write
//  multi-byte integers in network byte order (big-endian). These small cursors
//  centralise that so the packet/ObjectStream layers stay readable.
// ============================================================================

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(initialCapacity = 1024) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    const need = this.pos + extra;
    if (need <= this.buf.length) {
      return;
    }
    let cap = this.buf.length * 2;
    while (cap < need) {
      cap *= 2;
    }
    const grown = new Uint8Array(cap);
    grown.set(this.buf);
    this.buf = grown;
    this.view = new DataView(this.buf.buffer);
  }

  get length(): number {
    return this.pos;
  }

  u8(value: number): this {
    this.ensure(1);
    this.view.setUint8(this.pos, value);
    this.pos += 1;
    return this;
  }

  u16(value: number): this {
    this.ensure(2);
    this.view.setUint16(this.pos, value); // big-endian (default)
    this.pos += 2;
    return this;
  }

  u32(value: number): this {
    this.ensure(4);
    this.view.setUint32(this.pos, value >>> 0);
    this.pos += 4;
    return this;
  }

  u64(value: bigint): this {
    this.ensure(8);
    this.view.setBigUint64(this.pos, value);
    this.pos += 8;
    return this;
  }

  bytes(src: Uint8Array): this {
    this.ensure(src.length);
    this.buf.set(src, this.pos);
    this.pos += src.length;
    return this;
  }

  /** Snapshot of everything written so far (copied, safe to keep). */
  toBuffer(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

export class ByteReader {
  private view: DataView;
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  u64(): bigint {
    const v = this.view.getBigUint64(this.pos);
    this.pos += 8;
    return v;
  }

  take(count: number): Uint8Array {
    const slice = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }
}
