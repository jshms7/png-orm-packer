'use strict';

(function () {
  const fold = value => value.normalize('NFC').toLowerCase();
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const encoder = new TextEncoder();

  function safePath(path) {
    if (typeof path !== 'string' || !path || encoder.encode(path).length > 4096 ||
        /[\\\\:<>"|?*]|[\p{Cc}\p{Cf}\p{Cs}]/u.test(path)) {
      throw new Error('unsafe or invalid relative path');
    }
    for (const part of path.split('/')) {
      if (!part || part === '.' || part === '..' || part.trim() !== part || part.endsWith('.') ||
          encoder.encode(part).length > 255 || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(part.split('.')[0].trimEnd())) {
        throw new Error('unsafe or invalid path component');
      }
    }
    return path;
  }

  // Return all leaf IDs involved in a duplicate, alias or file/directory conflict.
  function namespaceConflicts(paths) {
    const nodes = new Map();
    for (const path of paths) {
      const parts = path.split('/');
      for (let index = 1; index <= parts.length; index++) {
        const spelling = parts.slice(0, index).join('/');
        const id = fold(spelling);
        if (!nodes.has(id)) nodes.set(id, { spelling, alias: false, files: 0, directory: false });
        const node = nodes.get(id);
        if (node.spelling !== spelling) node.alias = true;
        if (index === parts.length) node.files++;
        else node.directory = true;
      }
    }
    const bad = new Set([...nodes].filter(([, node]) => node.alias || node.files > 1 ||
      (node.files && node.directory)).map(([id]) => id));
    const conflicts = new Set();
    for (const path of paths) {
      const parts = path.split('/');
      if (parts.some((_, index) => bad.has(fold(parts.slice(0, index + 1).join('/'))))) conflicts.add(fold(path));
    }
    return conflicts;
  }

  function planFiles(files) {
    if (!Array.isArray(files)) throw new TypeError('files must be an array');
    const candidates = new Map();
    const paths = new Map();
    const sourcePaths = [];
    const issues = [];
    for (const file of files) {
      let path;
      try {
        if (!file || typeof file.name !== 'string' || file.name.includes('/') ||
            (file.webkitRelativePath !== undefined && typeof file.webkitRelativePath !== 'string')) {
          throw new Error('invalid file metadata');
        }
        safePath(file.name);
        path = safePath(file.webkitRelativePath || file.name);
        if (path.split('/').at(-1) !== file.name) throw new Error('invalid file name/path mismatch');
      } catch (error) {
        issues.push(`Rejected ${JSON.stringify(file && file.name)}: ${error.message}.`);
        continue;
      }
      sourcePaths.push(path);
      const pathId = fold(path);
      paths.set(pathId, (paths.get(pathId) || 0) + 1);
      const slash = path.lastIndexOf('/');
      const match = /^(.*)_(ao|roughness|metallic)\.png$/i.exec(path.slice(slash + 1));
      if (!match) continue;
      const key = path.slice(0, slash + 1) + match[1];
      try {
        safePath(key);
        safePath(`${key}_orm.png`);
      } catch (error) {
        issues.push(`Rejected ${JSON.stringify(path)}: unsafe or empty material stem.`);
        continue;
      }
      const id = fold(key);
      if (!candidates.has(id)) candidates.set(id, { keys: new Set(), channels: { ao: [], roughness: [], metallic: [] }, paths: [] });
      const candidate = candidates.get(id);
      candidate.keys.add(key);
      candidate.channels[match[2].toLowerCase()].push(file);
      candidate.paths.push(pathId);
    }
    const groups = [];
    for (const candidate of candidates.values()) {
      const key = [...candidate.keys].sort()[0];
      const outputName = `${key}_orm.png`;
      if (candidate.keys.size !== 1 || candidate.paths.some(path => paths.get(path) > 1) ||
          Object.values(candidate.channels).some(matches => matches.length > 1)) {
        issues.push(`${key}: ambiguous or duplicate source path collision; group skipped.`);
        continue;
      }
      if (paths.has(fold(outputName))) {
        issues.push(`${key}: output/source path collision; group skipped.`);
        continue;
      }
      const missing = ['ao', 'roughness', 'metallic'].filter(channel => !candidate.channels[channel].length);
      if (missing.length) issues.push(`${key}: missing ${missing.join(', ')}.`);
      else groups.push({ key, outputName, ao: candidate.channels.ao[0], roughness: candidate.channels.roughness[0], metallic: candidate.channels.metallic[0] });
    }
    const conflicts = namespaceConflicts([...sourcePaths, ...groups.map(group => group.outputName)]);
    const safeGroups = groups.filter(group => {
      const groupPaths = [group.outputName, ...[group.ao, group.roughness, group.metallic].map(file => file.webkitRelativePath || file.name)];
      if (!groupPaths.some(path => conflicts.has(fold(path)))) return true;
      issues.push(`${group.key}: ambiguous directory or file/output namespace collision; group skipped.`);
      return false;
    });
    safeGroups.sort((a, b) => compare(a.key, b.key));
    return { groups: safeGroups, issues: issues.sort() };
  }
  const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc >>> 0;
  });

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeZip(entries) {
    if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
    if (entries.length > 10000) throw new RangeError('ZIP entry count limit is 10000 (no Zip64)');
    const records = [];
    for (const entry of entries) {
      if (!entry || !(entry.bytes instanceof Uint8Array)) throw new TypeError('invalid entry: bytes must be Uint8Array');
      const name = safePath(entry.name);
      records.push({ name, bytes: entry.bytes, encodedName: encoder.encode(name) });
    }
    if (namespaceConflicts(records.map(entry => entry.name)).size) {
      throw new Error('duplicate, ambiguous or file/directory path collision');
    }
    records.sort((a, b) => compare(a.name, b.name));
    const localSize = records.reduce((size, entry) => size + 30 + entry.encodedName.length + entry.bytes.length, 0);
    const centralSize = records.reduce((size, entry) => size + 46 + entry.encodedName.length, 0);
    if (localSize + centralSize + 22 > 128 * 1024 * 1024) {
      throw new RangeError('ZIP total size limit is 128 MiB including metadata (no Zip64)');
    }
    const output = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(output.buffer);
    const u16 = (offset, value) => view.setUint16(offset, value, true);
    const u32 = (offset, value) => view.setUint32(offset, value, true);
    let offset = 0;
    for (const entry of records) {
      entry.offset = offset;
      entry.crc = crc32(entry.bytes);
      u32(offset, 0x04034b50);
      u16(offset + 4, 20);
      u16(offset + 6, 0x800);
      // Stored (method 0), time 00:00:00, date 1980-01-01; no host clock.
      u16(offset + 12, 33);
      u32(offset + 14, entry.crc);
      u32(offset + 18, entry.bytes.length);
      u32(offset + 22, entry.bytes.length);
      u16(offset + 26, entry.encodedName.length);
      output.set(entry.encodedName, offset + 30);
      output.set(entry.bytes, offset + 30 + entry.encodedName.length);
      offset += 30 + entry.encodedName.length + entry.bytes.length;
    }
    for (const entry of records) {
      u32(offset, 0x02014b50);
      u16(offset + 4, 20);
      u16(offset + 6, 20);
      u16(offset + 8, 0x800);
      u16(offset + 14, 33);
      u32(offset + 16, entry.crc);
      u32(offset + 20, entry.bytes.length);
      u32(offset + 24, entry.bytes.length);
      u16(offset + 28, entry.encodedName.length);
      u32(offset + 42, entry.offset);
      output.set(entry.encodedName, offset + 46);
      offset += 46 + entry.encodedName.length;
    }
    u32(offset, 0x06054b50);
    u16(offset + 8, records.length);
    u16(offset + 10, records.length);
    u32(offset + 12, centralSize);
    u32(offset + 16, localSize);
    return output;
  }

  const api = { planFiles, makeZip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.TextureBatch = api;
})();
