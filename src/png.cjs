'use strict';

(function () {
  const MAX_DIMENSION = 4096;
  const MAX_INPUT_BYTES = 32 * 1024 * 1024;

  function checkDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) ||
        width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new Error('Image dimensions must be integers from 1 to 4096');
    }
  }

  function checkImage(image) {
    if (!image || typeof image !== 'object') throw new Error('Expected decoded RGBA image');
    checkDimensions(image.width, image.height);
    if (!(image.data instanceof Uint8Array) || image.data.length !== image.width * image.height * 4) {
      throw new Error('RGBA data must be a Uint8Array of width * height * 4 bytes');
    }
  }

  function packOrm({ ao, roughness, metallic, invertRoughness = false }) {
    for (const mask of [ao, roughness, metallic]) checkImage(mask);
    if (roughness.width !== ao.width || roughness.height !== ao.height ||
        metallic.width !== ao.width || metallic.height !== ao.height) {
      throw new Error('Mask dimension mismatch');
    }
    if (typeof invertRoughness !== 'boolean') throw new Error('invertRoughness must be boolean');
    const data = new Uint8Array(ao.width * ao.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = ao.data[i];
      data[i + 1] = invertRoughness ? 255 - roughness.data[i] : roughness.data[i];
      data[i + 2] = metallic.data[i];
      data[i + 3] = 255;
    }
    return { width: ao.width, height: ao.height, data };
  }

  const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    CRC_TABLE[n] = value >>> 0;
  }

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
    return (value ^ 0xffffffff) >>> 0;
  }

  // Never collect unbounded inflated output. Cancel the stream on the first
  // oversized chunk, before copying any of that chunk into the fixed buffer.
  async function inflateExact(compressed, expected) {
    if (typeof DecompressionStream !== 'function') throw new Error('DecompressionStream is required');
    let position = 0;
    const source = new ReadableStream({
      pull(controller) {
        if (position === compressed.length) return controller.close();
        const end = Math.min(position + 16384, compressed.length);
        controller.enqueue(compressed.subarray(position, end));
        position = end;
      }
    });
    const reader = source.pipeThrough(new DecompressionStream('deflate')).getReader();
    const output = new Uint8Array(expected);
    let used = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value.length > expected - used) {
          throw new Error('PNG decompressed data exceeds expected size');
        }
        output.set(value, used);
        used += value.length;
      }
      if (used !== expected) throw new Error('PNG decompressed size does not match expected size');
      return output;
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      throw new Error('Invalid PNG compressed data: ' + error.message);
    } finally {
      reader.releaseLock();
    }
  }

  async function decodePng(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('PNG input must be Uint8Array');
    if (bytes.length > MAX_INPUT_BYTES) throw new Error('PNG input exceeds 32 MiB limit');
    if (bytes.length < 8 || !SIGNATURE.every((byte, i) => bytes[i] === byte)) {
      throw new Error('Invalid PNG signature');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parts = [];
    let width, height, colorType, channels, offset = 8, size = 0;
    let seenHeader = false, seenData = false, dataEnded = false, seenEnd = false;
    let transparency = null, seenPalette = false;
    let chunkCount = 0;
    while (offset < bytes.length) {
      if (++chunkCount > 65536) throw new Error('PNG chunk count exceeds limit of 65536');
      if (bytes.length - offset < 12) throw new Error('Truncated PNG chunk');
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) throw new Error('Truncated PNG chunk');
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      if (!/^[A-Za-z]{4}$/.test(type) || (bytes[offset + 6] & 32)) {
        throw new Error('Invalid PNG chunk name or reserved bit');
      }
      if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) {
        throw new Error('PNG CRC mismatch in ' + type);
      }
      if (!seenHeader && type !== 'IHDR') throw new Error('PNG IHDR must be first');
      if (seenData && type !== 'IDAT') dataEnded = true;
      if (type === 'IHDR') {
        if (seenHeader) throw new Error('Duplicate PNG IHDR');
        if (length !== 13) throw new Error('Invalid PNG IHDR');
        seenHeader = true;
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        checkDimensions(width, height);
        colorType = data[9];
        channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
        if (data[8] !== 8) throw new Error('Unsupported PNG bit depth; only 8-bit is supported');
        if (!channels) throw new Error('Unsupported PNG color type (palette is not supported)');
        if (data[10] || data[11]) throw new Error('Unsupported PNG compression or filter method');
        if (data[12]) throw new Error('Unsupported PNG interlace method');
      } else if (type === 'IDAT') {
        if (dataEnded) throw new Error('PNG IDAT chunks must be consecutive');
        seenData = true;
        parts.push(data);
        size += length;
      } else if (type === 'IEND') {
        if (length !== 0 || !seenData) throw new Error('Invalid PNG IEND or missing IDAT');
        seenEnd = true;
        if (offset + 12 !== bytes.length) throw new Error('Trailing bytes after PNG IEND');
      } else if (type === 'tRNS') {
        if (seenData || transparency || (colorType !== 0 && colorType !== 2) ||
            length !== (colorType === 0 ? 2 : 6)) {
          throw new Error('Invalid PNG tRNS transparency');
        }
        transparency = [];
        for (let i = 0; i < length; i += 2) {
          if (data[i] !== 0) throw new Error('PNG tRNS sample exceeds 8-bit range');
          transparency.push(data[i + 1]);
        }
      } else if (type === 'PLTE') {
        if (seenPalette || seenData || transparency || (colorType !== 2 && colorType !== 6) ||
            !length || length > 768 || length % 3) {
          throw new Error('Invalid PNG optional PLTE');
        }
        seenPalette = true;
      } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
        throw new Error('Unsupported PNG animation (APNG)');
      } else if (!(bytes[offset + 4] & 32)) {
        throw new Error('Unsupported PNG critical chunk: ' + type);
      }
      offset += length + 12;
    }
    if (!seenHeader || !seenData || !seenEnd) throw new Error('Missing PNG IHDR, IDAT or IEND');
    checkDimensions(width, height);
    const compressed = new Uint8Array(size);
    let cursor = 0;
    for (const part of parts) { compressed.set(part, cursor); cursor += part.length; }
    const stride = width * channels;
    const raw = await inflateExact(compressed, height * (1 + stride));
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const row = y * (stride + 1);
      const filter = raw[row];
      if (filter > 4) throw new Error('Invalid PNG filter (expected 0 to 4)');
      for (let x = 0; x < stride; x++) {
        const at = row + 1 + x;
        const left = x >= channels ? raw[at - channels] : 0;
        const up = y ? raw[at - stride - 1] : 0;
        const upperLeft = y && x >= channels ? raw[at - stride - 1 - channels] : 0;
        let predictor = 0;
        if (filter === 1) predictor = left;
        else if (filter === 2) predictor = up;
        else if (filter === 3) predictor = Math.floor((left + up) / 2);
        else if (filter === 4) {
          const estimate = left + up - upperLeft;
          const a = Math.abs(estimate - left);
          const b = Math.abs(estimate - up);
          const c = Math.abs(estimate - upperLeft);
          predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
        }
        raw[at] = (raw[at] + predictor) & 255;
      }
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const sample = row + 1 + x * channels;
        data[i] = raw[sample];
        data[i + 1] = colorType === 0 || colorType === 4 ? raw[sample] : raw[sample + 1];
        data[i + 2] = colorType === 0 || colorType === 4 ? raw[sample] : raw[sample + 2];
        data[i + 3] = colorType === 4 ? raw[sample + 1] : colorType === 6 ? raw[sample + 3] : 255;
        if (transparency && raw[sample] === transparency[0] &&
            (colorType === 0 || (raw[sample + 1] === transparency[1] && raw[sample + 2] === transparency[2]))) {
          data[i + 3] = 0;
        }
      }
    }
    return { width, height, data };
  }

  function makeChunk(type, data = new Uint8Array(0)) {
    const chunk = new Uint8Array(data.length + 12);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    view.setUint32(data.length + 8, crc32(chunk.subarray(4, data.length + 8)));
    return chunk;
  }

  async function encodePng(image) {
    checkImage(image);
    if (typeof CompressionStream !== 'function') throw new Error('CompressionStream is required');
    const { width, height, data } = image;
    const stride = width * 4;
    const raw = new Uint8Array(height * (stride + 1));
    for (let row = 0; row < height; row++) {
      raw.set(data.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
    }
    let position = 0;
    const source = new ReadableStream({
      pull(controller) {
        if (position === raw.length) return controller.close();
        const end = Math.min(position + 16384, raw.length);
        controller.enqueue(raw.subarray(position, end));
        position = end;
      }
    });
    const reader = source.pipeThrough(new CompressionStream('deflate')).getReader();
    const parts = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        // One IHDR, one IDAT and one IEND add 57 bytes including signature.
        if (value.length > MAX_INPUT_BYTES - 57 - size) throw new Error('Encoded PNG exceeds 32 MiB limit');
        parts.push(value);
        size += value.length;
      }
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const compressed = new Uint8Array(size);
    let cursor = 0;
    for (const part of parts) { compressed.set(part, cursor); cursor += part.length; }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header[8] = 8;
    header[9] = 6;
    const chunks = [SIGNATURE, makeChunk('IHDR', header), makeChunk('IDAT', compressed), makeChunk('IEND')];
    const result = new Uint8Array(size + 57);
    cursor = 0;
    for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.length; }
    return result;
  }

  const api = { decodePng, encodePng, packOrm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TexturePng = api;
})();
