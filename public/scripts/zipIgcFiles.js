export const MAX_ZIP_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_EXPANDED_BYTES = 250 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2000;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH_BYTES = 65_557;

export class ZipIgcError extends Error {}

function zipError(message) {
  return new ZipIgcError(message);
}

function findEndOfCentralDirectory(view) {
  const start = Math.max(0, view.byteLength - MAX_EOCD_SEARCH_BYTES);
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (
      view.getUint32(offset, true) === EOCD_SIGNATURE
      && offset + 22 + view.getUint16(offset + 20, true) === view.byteLength
    ) return offset;
  }
  throw zipError('This is not a valid ZIP archive.');
}

function safeIgcFilename(entryName) {
  const basename = entryName.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '_') ?? '';
  if (!basename || basename.length > 255) {
    throw zipError('An IGC entry has an invalid filename.');
  }
  return basename;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function inflateRaw(compressed, expectedSize, maximumSize) {
  if (typeof DecompressionStream !== 'function') {
    throw zipError('This browser cannot open compressed ZIP archives.');
  }

  let reader;
  try {
    reader = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
      .getReader();
  } catch {
    throw zipError('This browser cannot open compressed ZIP archives.');
  }

  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > expectedSize || byteLength > maximumSize) {
        await reader.cancel();
        throw zipError('An IGC entry expands beyond the allowed size.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ZipIgcError) throw error;
    throw zipError('A compressed IGC entry is corrupt.');
  }

  if (byteLength !== expectedSize) throw zipError('A compressed IGC entry has an invalid size.');
  const inflated = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    inflated.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return inflated;
}

function readEntries(bytes, options) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw zipError('Multi-part ZIP archives are not supported.');
  }
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw zipError('ZIP64 archives are not supported.');
  }
  if (entryCount > options.maxEntries) {
    throw zipError(`A ZIP archive can contain at most ${options.maxEntries} entries.`);
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryEnd > eocdOffset || centralDirectoryOffset > bytes.byteLength) {
    throw zipError('The ZIP archive directory is corrupt.');
  }

  const decoder = new TextDecoder();
  const entries = [];
  let skippedEntries = 0;
  let expandedBytes = 0;
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralDirectoryEnd || view.getUint32(cursor, true) !== CENTRAL_FILE_SIGNATURE) {
      throw zipError('The ZIP archive directory is corrupt.');
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const filenameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const nextCursor = cursor + 46 + filenameLength + extraLength + commentLength;
    if (nextCursor > centralDirectoryEnd) throw zipError('The ZIP archive directory is corrupt.');
    const entryName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + filenameLength));
    cursor = nextCursor;

    if ((flags & 1) !== 0) throw zipError('Encrypted ZIP archives are not supported.');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw zipError('ZIP64 archives are not supported.');
    }
    if (entryName.endsWith('/')) continue;
    const entryBasename = entryName.split(/[\\/]/).at(-1) ?? '';
    if (entryName.split(/[\\/]/).includes('__MACOSX') || entryBasename.startsWith('._')) {
      skippedEntries += 1;
      continue;
    }
    if (!entryName.toLowerCase().endsWith('.igc')) {
      skippedEntries += 1;
      continue;
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw zipError('An IGC entry uses an unsupported compression method.');
    }
    if (uncompressedSize < 1 || uncompressedSize > options.maxEntryBytes) {
      throw zipError(`Every IGC entry must be non-empty and ${Math.floor(options.maxEntryBytes / 1024 / 1024)} MB or smaller.`);
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > options.maxExpandedBytes) {
      throw zipError(`A ZIP archive can expand to at most ${Math.floor(options.maxExpandedBytes / 1024 / 1024)} MB.`);
    }
    entries.push({
      filename: safeIgcFilename(entryName), flags, compressionMethod, checksum,
      compressedSize, uncompressedSize, localHeaderOffset,
    });
  }
  if (cursor !== centralDirectoryEnd) throw zipError('The ZIP archive directory is corrupt.');
  if (!entries.length) throw zipError('The ZIP archive does not contain any IGC files.');
  return { entries, skippedEntries, view, centralDirectoryOffset };
}

async function extractEntry(bytes, entry, view, centralDirectoryOffset, maxEntryBytes) {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.byteLength || view.getUint32(offset, true) !== LOCAL_FILE_SIGNATURE) {
    throw zipError('An IGC entry has a corrupt local header.');
  }
  const localFlags = view.getUint16(offset + 6, true);
  const localMethod = view.getUint16(offset + 8, true);
  const filenameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  if ((localFlags & 1) !== 0 || localMethod !== entry.compressionMethod) {
    throw zipError('An IGC entry has inconsistent ZIP metadata.');
  }
  const dataOffset = offset + 30 + filenameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > centralDirectoryOffset) throw zipError('An IGC entry is truncated.');
  const compressed = bytes.subarray(dataOffset, dataEnd);
  let contents;
  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) throw zipError('An IGC entry has an invalid stored size.');
    contents = new Uint8Array(compressed);
  } else {
    contents = await inflateRaw(compressed, entry.uncompressedSize, maxEntryBytes);
  }
  if (crc32(contents) !== entry.checksum) throw zipError('An IGC entry failed its ZIP integrity check.');
  return contents;
}

export async function extractIgcFilesFromZip(archive, overrides = {}) {
  const options = {
    maxArchiveBytes: MAX_ZIP_FILE_BYTES,
    maxEntries: MAX_ZIP_ENTRIES,
    maxEntryBytes: 10 * 1024 * 1024,
    maxExpandedBytes: MAX_ZIP_EXPANDED_BYTES,
    ...overrides,
  };
  if (!archive || archive.size < 1 || archive.size > options.maxArchiveBytes) {
    throw zipError(`ZIP archives must be non-empty and ${Math.floor(options.maxArchiveBytes / 1024 / 1024)} MB or smaller.`);
  }

  let bytes;
  try {
    bytes = new Uint8Array(await archive.arrayBuffer());
  } catch {
    throw zipError('The ZIP archive could not be read.');
  }
  const { entries, skippedEntries, view, centralDirectoryOffset } = readEntries(bytes, options);
  const files = [];
  for (const entry of entries) {
    const contents = await extractEntry(bytes, entry, view, centralDirectoryOffset, options.maxEntryBytes);
    files.push(new File([contents], entry.filename, {
      type: 'application/octet-stream',
      lastModified: archive.lastModified || Date.now(),
    }));
  }
  return { files, skippedEntries };
}
