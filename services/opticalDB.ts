/**
 * OpticalDB: IndexedDB persistence for blocks and recovery
 *
 * Implements:
 * - Block storage and retrieval
 * - File session persistence
 * - Recovery/resume protocol support
 */

const DB_NAME = 'opticalsend';
const DB_VERSION = 1;
const BLOCKS_STORE = 'blocks';
const SESSIONS_STORE = 'sessions';

export interface StoredBlock {
  fileId: string;
  seq: number;
  header: string; // JSON
  payload: ArrayBuffer;
  state: string;
  decompressed?: ArrayBuffer;
}

export interface StoredSession {
  sessionId: string;
  fileId: string;
  role: 'sender' | 'receiver';
  filename: string;
  totalSize: number;
  totalBlocks: number;
  symmetricKeyDerivative: string; // for resume
  createdAt: number;
  updatedAt: number;
}

/**
 * IndexedDB store for blocks and sessions
 */
export class BlockStore {
  private db?: IDBDatabase;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create blocks store
        if (!db.objectStoreNames.contains(BLOCKS_STORE)) {
          const blockStore = db.createObjectStore(BLOCKS_STORE, {
            keyPath: ['fileId', 'seq'],
          });
          blockStore.createIndex('fileId', 'fileId', { unique: false });
          blockStore.createIndex('state', 'state', { unique: false });
        }

        // Create sessions store
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const sessionStore = db.createObjectStore(SESSIONS_STORE, {
            keyPath: 'sessionId',
          });
          sessionStore.createIndex('fileId', 'fileId', { unique: false });
        }
      };
    });
  }

  async storeBlock(block: StoredBlock): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([BLOCKS_STORE], 'readwrite');
      const store = tx.objectStore(BLOCKS_STORE);
      const request = store.put(block);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getBlocksForFile(fileId: string): Promise<StoredBlock[]> {
    if (!this.db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([BLOCKS_STORE], 'readonly');
      const store = tx.objectStore(BLOCKS_STORE);
      const index = store.index('fileId');
      const request = index.getAll(fileId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getBlock(fileId: string, seq: number): Promise<StoredBlock | undefined> {
    if (!this.db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([BLOCKS_STORE], 'readonly');
      const store = tx.objectStore(BLOCKS_STORE);
      const request = store.get([fileId, seq]);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async deleteFileBlocks(fileId: string): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([BLOCKS_STORE], 'readwrite');
      const store = tx.objectStore(BLOCKS_STORE);
      const index = store.index('fileId');
      const request = index.openCursor(fileId);

      request.onerror = () => reject(request.error);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  async storeSession(session: StoredSession): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([SESSIONS_STORE], 'readwrite');
      const store = tx.objectStore(SESSIONS_STORE);
      const request = store.put(session);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getSession(sessionId: string): Promise<StoredSession | undefined> {
    if (!this.db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([SESSIONS_STORE], 'readonly');
      const store = tx.objectStore(SESSIONS_STORE);
      const request = store.get(sessionId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getAllSessions(): Promise<StoredSession[]> {
    if (!this.db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([SESSIONS_STORE], 'readonly');
      const store = tx.objectStore(SESSIONS_STORE);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([SESSIONS_STORE], 'readwrite');
      const store = tx.objectStore(SESSIONS_STORE);
      const request = store.delete(sessionId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearAllData(): Promise<void> {
    if (!this.db) throw new Error('DB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([BLOCKS_STORE, SESSIONS_STORE], 'readwrite');

      const blockReq = tx.objectStore(BLOCKS_STORE).clear();
      const sessionReq = tx.objectStore(SESSIONS_STORE).clear();

      blockReq.onerror = () => reject(blockReq.error);
      sessionReq.onerror = () => reject(sessionReq.error);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.initialized = false;
    }
  }
}
