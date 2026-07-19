// @ts-nocheck Browser JavaScript is tested directly without a generated declaration file.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractIgcFilesFromZip, ZipIgcError } from '../../public/scripts/zipIgcFiles.js';
import { createZipFile } from '../helpers/createZipFile.js';

describe('IGC ZIP extraction', () => {
  it('extracts an existing known-good repository IGC from a ZIP', async () => {
    const source = readFileSync(new URL('../inputs/2026-05-10-XNA-54F3F9B76F42505D1B592F21726CAF48-01.igc', import.meta.url));
    const archive = createZipFile([{
      name: 'exports/known-good.igc',
      contents: source,
      compression: 'deflated',
    }]);

    const result = await extractIgcFilesFromZip(archive);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe('known-good.igc');
    expect(result.files[0]?.size).toBe(source.byteLength);
    await expect(result.files[0]?.text()).resolves.toContain('HFDTEDATE:100526,01');
  });

  it('extracts stored and deflated IGC files using safe basenames', async () => {
    const archive = createZipFile([
      { name: 'first.igc', contents: 'AXXX\nHFDTE010126\n', compression: 'stored' },
      { name: 'nested/second.IGC', contents: 'AXXX\nHFDTE020126\n', compression: 'deflated' },
      { name: '__MACOSX/._first.igc', contents: 'metadata', compression: 'deflated' },
      { name: 'notes.txt', contents: 'not a flight' },
    ]);

    const result = await extractIgcFilesFromZip(archive);

    expect(result.skippedEntries).toBe(2);
    expect(result.files.map((file) => file.name)).toEqual(['first.igc', 'second.IGC']);
    await expect(result.files[0]?.text()).resolves.toContain('HFDTE010126');
    await expect(result.files[1]?.text()).resolves.toContain('HFDTE020126');
  });

  it('rejects archives without IGC files', async () => {
    await expect(extractIgcFilesFromZip(createZipFile([
      { name: 'notes.txt', contents: 'not a flight' },
    ]))).rejects.toThrow('does not contain any IGC files');
  });

  it('rejects corrupt and encrypted IGC entries', async () => {
    await expect(extractIgcFilesFromZip(createZipFile([
      { name: 'bad.igc', contents: 'flight', checksum: 123 },
    ]))).rejects.toThrow('integrity check');
    await expect(extractIgcFilesFromZip(createZipFile([
      { name: 'secret.igc', contents: 'flight', encrypted: true },
    ]))).rejects.toThrow('Encrypted ZIP archives are not supported');
  });

  it('enforces entry count, individual size, and total expanded size limits', async () => {
    const twoFlights = createZipFile([
      { name: 'one.igc', contents: '1234' },
      { name: 'two.igc', contents: '5678' },
    ]);

    await expect(extractIgcFilesFromZip(twoFlights, { maxEntries: 1 })).rejects.toThrow('at most 1 entries');
    await expect(extractIgcFilesFromZip(twoFlights, { maxEntryBytes: 3 })).rejects.toThrow('Every IGC entry');
    await expect(extractIgcFilesFromZip(twoFlights, { maxExpandedBytes: 7 })).rejects.toThrow('expand to at most 0 MB');
  });

  it('rejects a file that is not a ZIP archive', async () => {
    const archive = new File(['not a zip'], 'broken.zip', { type: 'application/zip' });
    await expect(extractIgcFilesFromZip(archive)).rejects.toBeInstanceOf(ZipIgcError);
  });
});
