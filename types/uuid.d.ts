// Minimal declaration for 'uuid' to satisfy TypeScript when @types/uuid isn't present
// This provides the v1/v4/v5 signatures used in this codebase.

declare module 'uuid' {
  /**
   * Generate a RFC4122 v4 UUID string
   */
  export function v4(): string;

  /**
   * Generate a RFC4122 v1 UUID string
   */
  export function v1(): string;

  /**
   * Generate a RFC4122 v5 UUID (name-based)
   */
  export function v5(name: string, namespace: string): string;

  // Allow named imports like: import { v4 as uuidv4 } from 'uuid';
  export {};
}
