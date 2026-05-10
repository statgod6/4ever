import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * Document storage for the Knowledge Worker.
 *
 * Local filesystem implementation backed by backend/uploads/kw-docs/<userId>/.
 * The interface is intentionally small (`put`, `get`, `delete`) so the whole
 * thing can be swapped for Cloudflare R2 / S3 later without touching callers.
 */
@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly root = path.resolve(process.cwd(), 'uploads', 'kw-docs');

  private async ensureUserDir(userId: string): Promise<string> {
    const dir = path.join(this.root, userId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /** Store a buffer under a user scope. Returns a storage path relative to `root`. */
  async put(userId: string, originalName: string, buffer: Buffer): Promise<string> {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const key = `${randomUUID()}-${safeName}`;
    const dir = await this.ensureUserDir(userId);
    const full = path.join(dir, key);
    await fs.writeFile(full, buffer);
    // Relative path, POSIX-style for portability
    const rel = path.posix.join(userId, key);
    this.logger.log(`Stored ${rel} (${buffer.length} bytes)`);
    return rel;
  }

  /** Read a previously-stored document. */
  async get(storagePath: string): Promise<Buffer> {
    const full = path.resolve(this.root, storagePath);
    if (!full.startsWith(this.root)) throw new Error('Invalid storage path');
    return fs.readFile(full);
  }

  /** Delete a stored document (soft-fails if missing). */
  async delete(storagePath: string): Promise<void> {
    try {
      const full = path.resolve(this.root, storagePath);
      if (!full.startsWith(this.root)) return;
      await fs.unlink(full);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') this.logger.warn(`Failed to delete ${storagePath}: ${e?.message}`);
    }
  }
}
