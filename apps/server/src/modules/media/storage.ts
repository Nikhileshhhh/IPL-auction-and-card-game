import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Private object storage for media variants. Keys are validated server-built
 * paths (never user input); buckets are never public (DB/realtime §1194).
 */
export interface MediaStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(keys: readonly string[]): Promise<void>;
  /** Every object key under a prefix (room cleanup re-lists until empty). */
  list(prefix: string): Promise<string[]>;
}

const KEY = /^[a-z0-9][a-z0-9/_.-]{2,240}$/;

function assertKey(key: string) {
  if (!KEY.test(key) || key.includes('..')) throw new Error('invalid media key');
}

export class LocalDiskStorage implements MediaStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string) {
    assertKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error('invalid media key');
    return full;
  }

  async put(key: string, bytes: Buffer) {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }

  async remove(keys: readonly string[]) {
    await Promise.all(keys.map((k) => rm(this.path(k), { force: true })));
  }

  async list(prefix: string) {
    const base = this.path(prefix.replace(/\/$/, ''));
    try {
      const entries = await readdir(base, { recursive: true, withFileTypes: true });
      return entries
        .filter((e) => e.isFile())
        .map((e) =>
          join(e.parentPath, e.name)
            .slice(this.root.length + 1)
            .split(sep)
            .join('/'),
        )
        .sort();
    } catch {
      return [];
    }
  }
}

/** Supabase Storage over its REST API with the server-only service key. */
export class SupabaseStorage implements MediaStorage {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
  ) {}

  private endpoint(key: string) {
    assertKey(key);
    return `${this.url.replace(/\/$/, '')}/storage/v1/object/${this.bucket}/${key}`;
  }

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }

  async put(key: string, bytes: Buffer, contentType: string) {
    const res = await fetch(this.endpoint(key), {
      method: 'POST',
      headers: this.headers({ 'content-type': contentType, 'x-upsert': 'true' }),
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`storage put failed (${res.status})`);
  }

  async get(key: string) {
    const res = await fetch(this.endpoint(key), {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`storage get failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(keys: readonly string[]) {
    if (keys.length === 0) return;
    keys.forEach(assertKey);
    const res = await fetch(`${this.url.replace(/\/$/, '')}/storage/v1/object/${this.bucket}`, {
      method: 'DELETE',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes: keys }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`storage remove failed (${res.status})`);
  }

  async list(prefix: string): Promise<string[]> {
    const folder = prefix.replace(/\/$/, '');
    assertKey(folder);
    const out: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(
        `${this.url.replace(/\/$/, '')}/storage/v1/object/list/${this.bucket}`,
        {
          method: 'POST',
          headers: this.headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ prefix: folder, limit: 1000, offset }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) throw new Error(`storage list failed (${res.status})`);
      const page = (await res.json()) as { name: string; id: string | null }[];
      for (const item of page) {
        const key = `${folder}/${item.name}`;
        // Folders have no id: walk into them.
        if (item.id === null) out.push(...(await this.list(key)));
        else out.push(key);
      }
      if (page.length < 1000) break;
    }
    return out.sort();
  }
}
