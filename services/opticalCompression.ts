/**
 * OpticalCompression: Lossless compression with auto-selection
 *
 * Implements:
 * - gzip/deflate via pako
 * - none (raw)
 * - brotli (future)
 * - Auto-selection heuristic: tries gzip, uses none if result is larger than 95% of original
 */

import pako from 'pako';

export type CompressionType = 'gzip' | 'none' | 'brotli';

export interface CompressionResult {
  compressed: Uint8Array;
  type: CompressionType;
  originalSize: number;
}

/**
 * Compress data with specified algorithm
 */
export async function compress(
  data: Uint8Array,
  algorithm: CompressionType
): Promise<Uint8Array> {
  switch (algorithm) {
    case 'gzip':
      return pako.gzip(data);
    case 'brotli':
      // Future: implement brotli if JS library available
      console.warn('brotli not implemented, falling back to none');
      return data;
    case 'none':
    default:
      return data;
  }
}

/**
 * Decompress data with specified algorithm
 */
export async function decompress(
  data: Uint8Array,
  algorithm: CompressionType
): Promise<Uint8Array> {
  switch (algorithm) {
    case 'gzip':
      return pako.ungzip(data);
    case 'brotli':
      console.warn('brotli not implemented, assuming no compression');
      return data;
    case 'none':
    default:
      return data;
  }
}

/**
 * Auto-select best compression for data.
 * Tries gzip; if result is >95% of original, uses none.
 */
export async function selectBestCompression(
  data: Uint8Array
): Promise<CompressionResult> {
  try {
    const gzipped = await compress(data, 'gzip');

    // If compression saves >5%, use gzip; else use none
    if (gzipped.length < data.length * 0.95) {
      return {
        compressed: gzipped,
        type: 'gzip',
        originalSize: data.length,
      };
    }
  } catch (error) {
    console.warn('Gzip compression failed, using none:', error);
  }

  return {
    compressed: data,
    type: 'none',
    originalSize: data.length,
  };
}

/**
 * Get compression efficiency ratio
 */
export function getCompressionRatio(
  originalSize: number,
  compressedSize: number
): number {
  if (originalSize === 0) return 0;
  return 1 - compressedSize / originalSize;
}
