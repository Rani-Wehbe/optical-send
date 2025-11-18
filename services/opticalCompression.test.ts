/**
 * Unit tests for OpticalCompression module
 *
 * Tests:
 * - Gzip compression/decompression
 * - None compression (passthrough)
 * - Auto-selection heuristic
 * - Round-trip compression consistency
 */

import { describe, it, expect } from 'vitest';
import {
  compress,
  decompress,
  selectBestCompression,
  getCompressionRatio,
} from '../services/opticalCompression';

describe('OpticalCompression', () => {
  describe('Gzip Compression', () => {
    it('should compress and decompress data correctly', async () => {
      const original = new Uint8Array(
        new Array(1000).fill(0).map((_, i) => i % 256)
      );

      const compressed = await compress(original, 'gzip');
      expect(compressed.length < original.length).toBe(true);

      const decompressed = await decompress(compressed, 'gzip');
      expect(decompressed).toEqual(original);
    });

    it('should handle repetitive data efficiently', async () => {
      const repetitive = new Uint8Array(10000).fill(42);

      const compressed = await compress(repetitive, 'gzip');
      const ratio = getCompressionRatio(repetitive.length, compressed.length);

      // Highly repetitive data should compress very well
      expect(ratio).toBeGreaterThan(0.5);
    });

    it('should round-trip arbitrary binary data', async () => {
      const random = crypto.getRandomValues(new Uint8Array(512));

      const compressed = await compress(random, 'gzip');
      const decompressed = await decompress(compressed, 'gzip');

      expect(decompressed).toEqual(random);
    });
  });

  describe('None Compression', () => {
    it('should pass through data unchanged', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const result = await compress(data, 'none');
      expect(result).toEqual(data);
    });
  });

  describe('Auto-Selection', () => {
    it('should select gzip for compressible data', async () => {
      const compressible = new Uint8Array(1000).fill(65); // 'A'

      const result = await selectBestCompression(compressible);
      expect(result.type).toBe('gzip');
      expect(result.compressed.length < compressible.length).toBe(true);
    });

    it('should select none for incompressible data', async () => {
      const incompressible = crypto.getRandomValues(new Uint8Array(1000));

      const result = await selectBestCompression(incompressible);
      expect(result.type).toBe('none');
      expect(result.compressed).toEqual(incompressible);
    });

    it('should preserve original size in result', async () => {
      const data = new Uint8Array(512);
      const result = await selectBestCompression(data);

      expect(result.originalSize).toBe(512);
    });
  });

  describe('Compression Ratio Calculation', () => {
    it('should calculate correct ratio', () => {
      const ratio = getCompressionRatio(1000, 500);
      expect(ratio).toBe(0.5);
    });

    it('should handle zero original size', () => {
      const ratio = getCompressionRatio(0, 100);
      expect(ratio).toBe(0);
    });
  });
});
