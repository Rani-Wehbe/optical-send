/**
 * OpticalAssembly: File assembly, validation, and download
 *
 * Implements:
 * - Block reassembly into final file bytes
 * - SHA-256 validation against manifest
 * - Blob generation and download
 * - Progress tracking
 */

import { computeSHA256 } from './opticalCrypto';
import { BlockStore } from './opticalDB';

export interface FileManifest {
  fileId: string;
  filename: string;
  totalSize: number;
  totalBlocks: number;
  sha256: string;
}

/**
 * Assemble received blocks into final file and validate
 */
export async function assembleAndValidateFile(
  fileId: string,
  blockStore: BlockStore,
  manifest: FileManifest,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  // Get all blocks for this file
  const blocks = await blockStore.getBlocksForFile(fileId);

  if (blocks.length === 0) {
    throw new Error('No blocks found for file');
  }

  // Sort by sequence number
  blocks.sort((a, b) => {
    const seqA = JSON.parse(a.header).seq;
    const seqB = JSON.parse(b.header).seq;
    return seqA - seqB;
  });

  // Check for missing blocks
  const expectedSeq = new Set(
    Array.from({ length: manifest.totalBlocks }, (_, i) => i)
  );
  const receivedSeq = new Set(
    blocks.map((b) => JSON.parse(b.header).seq)
  );
  const missingSeq = Array.from(expectedSeq).filter(
    (seq) => !receivedSeq.has(seq)
  );

  if (missingSeq.length > 0) {
    throw new Error(
      `Missing blocks: ${missingSeq.join(', ')}`
    );
  }

  // Assemble decompressed payloads
  const payloads: Uint8Array[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.decompressed) {
      payloads.push(new Uint8Array(block.decompressed));
    }
    onProgress?.(i + 1, blocks.length);
  }

  // Join all payloads
  const totalLength = payloads.reduce((sum, p) => sum + p.length, 0);
  const finalData = new Uint8Array(totalLength);
  let offset = 0;
  for (const payload of payloads) {
    finalData.set(payload, offset);
    offset += payload.length;
  }

  // Validate SHA-256
  const finalSha256 = await computeSHA256(finalData.buffer);
  if (finalSha256 !== manifest.sha256) {
    throw new Error(
      `SHA-256 mismatch. Expected ${manifest.sha256}, got ${finalSha256}`
    );
  }

  // Create blob
  return new Blob([finalData], { type: 'application/octet-stream' });
}

/**
 * Download blob with filename
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Calculate SHA-256 of file data (for manifest)
 */
export async function fileDataSha256(data: Uint8Array): Promise<string> {
  const dataCopy = new Uint8Array(data.length);
  dataCopy.set(data, 0);
  return computeSHA256(dataCopy.buffer);
}
