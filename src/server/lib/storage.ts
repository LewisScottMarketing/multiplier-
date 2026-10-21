import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal blob store on local disk. Keys are generated server-side and validated here so a
 * bad key can never escape the root. Swap the implementation for S3 when scaling out.
 */
export class Storage {
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  private resolve(key: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(key) || key.includes('..')) throw new Error(`Invalid storage key: ${key}`);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Uint8Array | string): Promise<void> {
    const full = this.resolve(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    // write-then-rename so a crash never leaves a half-written file that looks valid
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, full);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(this.resolve(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.promises.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.promises.rm(this.resolve(key), { force: true });
  }

  /** File names directly inside a "directory" (empty if it doesn't exist). */
  async list(prefix: string): Promise<string[]> {
    try {
      return await fs.promises.readdir(this.resolve(prefix));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  /** Deletes every file whose key starts with `prefix/` (a "directory"). */
  async deletePrefix(prefix: string): Promise<void> {
    await fs.promises.rm(this.resolve(prefix), { recursive: true, force: true });
  }
}
