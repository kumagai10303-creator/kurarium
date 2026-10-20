import Fastify, { type FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { authEnabled, isLoopbackHost, registerAuth } from './auth.js';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { getMediaItem, dataDir, type DB } from './db.js';
import {
  appVersion,
  configIniPath,
  loadConfig,
  writeServerConfig,
  type AppConfig,
} from './config.js';
import { hashPassword } from './password.js';
import { scanAll, scanStatus } from './scanner.js';
import { cleanupOrphanThumbs, startThumbQueue, thumbPath, thumbStatus } from './thumbnails.js';
import {
  isNativePlayable,
  recoverTranscodes,
  requestTranscode,
  nativeVideoSql,
  transcodeStatus,
} from './transcode.js';

import {
  createConnection,
  createLibrary,
  deleteConnection,
  deleteLibrary,
  getConnection,
  getLibrary,
  isAbsoluteMediaPath,
  kindForTab,
  listConnections,
  listLibraries,
  markLegacyDefaults,
  normalizeExtensions,
  reorderLibraries,
  updateConnection,
  updateLibrary,
  type PathInput,
} from './libraries.js';
import { registerCredential, testConnection } from './mount.js';
import {
  addItemTag,
  applyTagRules,
  attachTagsToRows,
  deleteTag,
  ensureTag,
  getItemTags,
  listTags,
  recentHistory,
  recordView,
  removeItemTag,
  saveResumePosition,
} from './tags.js';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.webp': 'image/webp', '.heic': 'image/heic', '.avif': 'image/avif',
  '.apng': 'image/apng',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime', '.wmv': 'video/x-ms-wmv', '.webm': 'video/webm',
  '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.flv': 'video/x-flv', '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
  '.ape': 'audio/x-ape', '.alac': 'audio/mp4', '.mka': 'audio/x-matroska',
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function webDistDir(): string {
  return (
    process.env.KURARIUM_WEB_DIR ??
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'dist')
  );
}

function logoFile(): string {
  const webDir = process.env.KURARIUM_WEB_DIR;
  if (webDir) return join(webDir, 'logo.svg');
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public', 'logo.svg');
}

function bufToObj(body: unknown): unknown {
  if (typeof body === 'string') {
    const s = body.trim();
    if (!s) return {};
    try {
      return JSON.parse(s);
    } catch {
      return { raw: s };
    }
  }
  return body;
}

function sendRange(
  rep: import('fastify').FastifyReply,
  itemPath: string,
  fileSize: number,
  contentType = 'video/mp4',
): unknown {
  const rangeHeader = rep.request.headers.range;
  rep.header('accept-ranges', 'bytes');
  rep.header('content-type', contentType);

  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!m || (m[1] === '' && m[2] === '')) {
      return rep.type('application/json').code(416).send({ error: 'invalid_range' });
    }
    let start = m[1] ? Number(m[1]) : 0;
    let end = fileSize - 1;
    if (m[1] !== '' && m[2] !== '') {
      end = Number(m[2]);
    } else if (m[1] === '' && m[2] !== '') {
      start = Math.max(0, fileSize - Number(m[2]));
    }
    if (start > end || start >= fileSize) {
      rep.header('content-range', `bytes */${fileSize}`);
      return rep.type('application/json').code(416).send({ error: 'invalid_range' });
    }
    if (end >= fileSize) end = fileSize - 1;
    rep.header('content-range', `bytes ${start}-${end}/${fileSize}`);
    rep.header('content-length', String(end - start + 1));
    return rep.code(206).send(createReadStream(itemPath, { start, end }));
  }

  rep.header('content-length', String(fileSize));
  return rep.send(createReadStream(itemPath));
}

export interface AppContext {
  config: AppConfig;
  db: DB;
}

const FOLDERS_CACHE_MS = 30_000;
let foldersCache: {
  libraryId: number;
  name: string;
  kind: string;
  tab: string;
  sub: string;
  count: number;
  counts: Record<string, number>;
  types: string[];
  sampleId: number | null;
  sampleWidth: number | null;
  sampleHeight: number | null;
}[] = [];
let foldersCacheAt = 0;

export async function buildApp({ config, db }: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // LAN公開時のみログインを要求(ログイン画面の資産は許可)
  registerAuth(app, config.server, db);

  // 空ボディの JSON / フォーム系 content-type を許容する
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, bufToObj(body));
  });
  app.addContentTypeParser(
    ['application/x-www-form-urlencoded', 'text/plain'],
    { parseAs: 'string' },
    (_req, _body, done) => done(null, {}),
  );

  app.get('/api/items', async (req, rep) => {
    const q = req.query as Record<string, string | undefined>;
    const type =
      q.type === 'image' || q.type === 'video' || q.type === 'pdf' || q.type === 'music'
        ? q.type
        : undefined;
    const folder = q.folder || undefined;
    const tabName = (q.tab ?? '').trim();
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.limit ?? DEFAULT_LIMIT)));
    const cursor = Math.max(0, Number(q.cursor ?? 0));

    const where: string[] = [
      "status = 'active'",
      // 無効化されたライブラリのアイテムは一覧に出さない(旧データの未紐付け行は表示)
      '(library_id IS NULL OR library_id IN (SELECT id FROM libraries WHERE enabled = 1))',
    ];
    const params: Record<string, unknown> = { limit: limit + 1 };
    const qRaw = (q.q ?? '').trim();
    const sortKeys: Record<string, string> = {
      id: 'id',
      name: 'file_name',
      mtime: 'mtime',
      size: 'size',
    };
    const sort = sortKeys[q.sort ?? 'id'] ?? 'id';
    const order = (q.order ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    if (tabName) {
      where.push(
        'library_id IN (SELECT id FROM libraries WHERE enabled = 1 AND tab_name = @tabName COLLATE NOCASE)',
      );
      params.tabName = tabName;
    } else if (type) {
      where.push('type = @type');
      params.type = type;
    }
    const onlySupportedVideos =
      (
        db
          .prepare("SELECT value FROM app_meta WHERE key = 'only_supported_videos'")
          .get() as { value: string } | undefined
      )?.value !== '0';

    const libraryId = q.library ? Number(q.library) : undefined;
    if (libraryId !== undefined && Number.isInteger(libraryId)) {
      where.push('library_id = @libraryId');
      params.libraryId = libraryId;
      const dir = (q.dir ?? '').replace(/^\\+|\\+$/g, '');
      if (dir) {
        const escaped = dir.replace(/[\\%_]/g, (m) => '\\' + m);
        where.push("file_name LIKE @dirPrefix ESCAPE '\\'");
        params.dirPrefix = escaped + '\\\\' + '%';
      }
    } else if (folder) {
      // 旧形式(フォルダ名\サブパス)との互換
      const sep = folder.indexOf('\\');
      const root = sep === -1 ? folder : folder.slice(0, sep);
      where.push('folder = @folder');
      params.folder = root;
      if (sep !== -1) {
        const sub = folder.slice(sep + 1);
        const escaped = sub.replace(/[\\%_]/g, (m) => '\\' + m);
        where.push("file_name LIKE @subPrefix ESCAPE '\\'");
        params.subPrefix = escaped + '%';
      }
    }
    // ページングは OFFSET(cursor=offset)ベースで統一。
    // FTS検索/タグ絞り込みでは id が連続しないため keyset 方式は使えない

    if (qRaw) {
      // FTS の unicode61 は日本語を単語分割できないため部分一致(LIKE)で検索する。
      // 空白区切りの複数語は AND 条件。
      const terms = qRaw.split(/\s+/).filter((t) => t.length > 0);
      terms.forEach((term, i) => {
        const escaped = term.replace(/[\\%_]/g, (m) => '\\' + m);
        where.push(`file_name LIKE @like${i} ESCAPE '\\'`);
        params[`like${i}`] = `%${escaped}%`;
      });
    }

    const tagFilter = (q.tags ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (tagFilter.length > 0) {
      const names = tagFilter.map((_, i) => `@tag${i}`);
      tagFilter.forEach((t, i) => {
        params[`tag${i}`] = t;
      });
      where.push(
        `id IN (
          SELECT g.media_id FROM (
            SELECT mt.media_id AS media_id, COUNT(DISTINCT mt.tag_id) AS c
            FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
            WHERE t.name COLLATE NOCASE IN (${names.join(',')})
            GROUP BY mt.media_id
          ) g WHERE g.c = ${tagFilter.length}
        )`,
      );
    }

    // 対応コーデック以外の動画は既定で非表示(設定で表示可能)
    if (onlySupportedVideos) {
      where.push(`(type != 'video' OR ${nativeVideoSql()})`);
    }

    // ORDER BY 句の列名と向きは上で検証済みの値から補間(@sort/@order はバインド不可)
    const rows = db
      .prepare(
        `SELECT * FROM media_items WHERE ${where.join(' AND ')} ORDER BY ${sort} ${order}, id ASC LIMIT @limit OFFSET @cursorOffset`,
      )
      .all({ ...params, cursorOffset: cursor });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    attachTagsToRows(db, items);
    return rep.send({
      items,
      nextCursor: hasMore && items.length > 0 ? Number(cursor) + items.length : null,
    });
  });

  app.get('/api/items/:id', async (req, rep) => {
    const item = getMediaItem(db, Number((req.params as { id: string }).id));
    if (!item) return rep.code(404).send({ error: 'not_found' });
    item.tags = getItemTags(db, item.id);
    return item;
  });

  app.get('/api/items/:id/thumbnail', async (req, rep) => {
    const item = getMediaItem(db, Number((req.params as { id: string }).id));
    if (!item) return rep.code(404).send({ error: 'not_found' });
    try {
      await stat(thumbPath(item.id));
      return rep.type('image/webp').send(createReadStream(thumbPath(item.id)));
    } catch {
      return rep
        .code(404)
        .send({ error: 'thumbnail_not_ready', thumbStatus: item.thumb_status });
    }
  });

  app.get('/api/items/:id/file', async (req, rep) => {
    const item = getMediaItem(db, Number((req.params as { id: string }).id));
    if (!item) return rep.code(404).send({ error: 'not_found' });
    if (item.status !== 'active') return rep.code(410).send({ error: 'gone' });

    let fileSize: number;
    try {
      fileSize = (await stat(item.path)).size;
    } catch {
      return rep.code(410).send({ error: 'file_missing' });
    }
    const mime = MIME[item.ext] ?? 'application/octet-stream';
    return sendRange(rep, item.path, fileSize, mime);
  });

  app.get('/api/folders', async (_req, rep) => {
    if (Date.now() - foldersCacheAt > FOLDERS_CACHE_MS) {
      const libs = listLibraries(db, false);
      const libById = new Map(libs.map((l) => [l.id, l]));
      const libOrder = new Map(libs.map((l, i) => [l.id, i]));
      const onlySupportedVideos =
        (
          db
            .prepare("SELECT value FROM app_meta WHERE key = 'only_supported_videos'")
            .get() as { value: string } | undefined
        )?.value !== '0';
      const videoFilter = onlySupportedVideos
        ? ` AND (mi.type != 'video' OR ${nativeVideoSql('mi.')})`
        : '';
      const rows = db
        .prepare(
          `SELECT mi.id, mi.library_id, mi.file_name, mi.type, mi.thumb_status, mi.width, mi.height
           FROM media_items mi JOIN libraries l ON l.id = mi.library_id
           WHERE mi.status = 'active' AND l.enabled = 1${videoFilter}`,
        )
        .all() as {
        id: number;
        library_id: number;
        file_name: string;
        type: string;
        thumb_status: string;
        width: number | null;
        height: number | null;
      }[];
      const sampleScore = (type: string): number =>
        type === 'image' ? 3 : type === 'video' ? 2 : 1;
      interface FolderAgg {
        libraryId: number;
        sub: string;
        count: number;
        byType: Record<string, number>;
        sampleId: number | null;
        sampleWidth: number | null;
        sampleHeight: number | null;
        sampleBest: number;
      }
      const counts = new Map<string, FolderAgg>();
      const add = (libraryId: number, sub: string, row: (typeof rows)[number]) => {
        const key = `${libraryId}::${sub}`;
        const cur = counts.get(key);
        const best = row.thumb_status === 'ready' ? sampleScore(row.type) : 0;
        if (cur) {
          cur.count++;
          cur.byType[row.type] = (cur.byType[row.type] ?? 0) + 1;
          if (best > cur.sampleBest) {
            cur.sampleBest = best;
            cur.sampleId = row.id;
            cur.sampleWidth = row.width;
            cur.sampleHeight = row.height;
          }
        } else {
          counts.set(key, {
            libraryId,
            sub,
            count: 1,
            byType: { [row.type]: 1 },
            sampleId: best > 0 ? row.id : null,
            sampleWidth: best > 0 ? row.width : null,
            sampleHeight: best > 0 ? row.height : null,
            sampleBest: best,
          });
        }
      };
      for (const row of rows) {
        const dirs = row.file_name.split('\\');
        dirs.pop(); // ファイル名を除外
        add(row.library_id, '', row);
        let sub = '';
        for (const part of dirs) {
          sub = sub ? `${sub}\\${part}` : part;
          add(row.library_id, sub, row);
        }
      }
      foldersCache = [...counts.values()]
        .map((v) => {
          const lib = libById.get(v.libraryId);
          return {
            libraryId: v.libraryId,
            name: lib?.name ?? '',
            kind: lib?.kind ?? 'image',
            tab: lib?.tab_name ?? '',
            sub: v.sub,
            count: v.count,
            counts: v.byType,
            types: Object.keys(v.byType).sort(),
            sampleId: v.sampleId,
            sampleWidth: v.sampleWidth,
            sampleHeight: v.sampleHeight,
          };
        })
        .sort(
          (a, b) =>
            (libOrder.get(a.libraryId) ?? 0) - (libOrder.get(b.libraryId) ?? 0) ||
            a.sub.localeCompare(b.sub, 'ja'),
        );
      foldersCacheAt = Date.now();
    }
    return foldersCache;
  });
  // ---- ライブラリ / SMB接続 / システム設定 ----

  const invalidateFolders = () => {
    foldersCacheAt = 0;
  };

  const parsePaths = (input: unknown): PathInput[] | string => {
    if (!Array.isArray(input)) return 'paths は配列で指定してください';
    const out: PathInput[] = [];
    for (const raw of input) {
      const p = raw as {
        provider?: string;
        path?: string;
        smbConnectionId?: number | null;
        enabled?: boolean;
      };
      if (p.provider !== 'local' && p.provider !== 'smb') {
        return 'provider は local または smb を指定してください';
      }
      const pathVal = (p.path ?? '').trim();
      if (!pathVal) return 'パスを入力してください';
      if (p.provider === 'local' && !isAbsoluteMediaPath(pathVal)) {
        return `ローカルパスは絶対パスで指定してください: ${pathVal}`;
      }
      if (p.provider === 'smb') {
        if (isAbsoluteMediaPath(pathVal)) {
          return 'SMB パスは共有内の相対パスで指定してください';
        }
        if (!p.smbConnectionId) return 'SMB パスには接続の指定が必要です';
        if (!getConnection(db, p.smbConnectionId)) return 'SMB 接続が見つかりません';
      }
      out.push({
        provider: p.provider,
        path: pathVal,
        smbConnectionId: p.provider === 'smb' ? (p.smbConnectionId ?? null) : null,
        enabled: p.enabled !== false,
      });
    }
    if (out.length === 0) return 'パスを1つ以上指定してください';
    return out;
  };

  // ライブラリ間でパスが重複/包含すると同じファイルの所属が入れ替わるため禁止する
  const pathCompareKey = (p: PathInput): string =>
    `${p.provider}:${p.provider === 'smb' ? p.smbConnectionId ?? '' : ''}:${p.path
      .replace(/[\\/]+$/, '')
      .replace(/\//g, '\\')
      .toLowerCase()}`;
  const pathsOverlap = (a: string, b: string): boolean =>
    a === b || a.startsWith(`${b}\\`) || b.startsWith(`${a}\\`);
  const validateNoOverlap = (paths: PathInput[], excludeLibraryId?: number): string | null => {
    const existing: { libraryId: number; libraryName: string; key: string }[] = [];
    for (const lib of listLibraries(db, true)) {
      if (excludeLibraryId !== undefined && lib.id === excludeLibraryId) continue;
      for (const p of lib.paths) {
        existing.push({
          libraryId: lib.id,
          libraryName: lib.name,
          key: pathCompareKey({
            provider: p.provider,
            path: p.path,
            smbConnectionId: p.smb_connection_id,
          }),
        });
      }
    }
    for (let i = 0; i < paths.length; i++) {
      const key = pathCompareKey(paths[i]);
      for (const e of existing) {
        if (pathsOverlap(key, e.key)) {
          return `パスが他のライブラリ「${e.libraryName}」と重複しています: ${paths[i].path}`;
        }
      }
      for (let j = 0; j < i; j++) {
        if (pathsOverlap(key, pathCompareKey(paths[j]))) {
          return `同じライブラリ内でパスが重複しています: ${paths[i].path}`;
        }
      }
    }
    return null;
  };
  app.get('/api/libraries', async () => ({ libraries: listLibraries(db, true) }));

  const parseLibraryMeta = (
    body: { tab?: string; extensions?: string[] | string },
  ): { tab: string; extensions: string[] } | string => {
    const tab = (body.tab ?? '').trim();
    if (!tab) return 'タブ名を入力してください';
    if (tab === '履歴' || tab === 'すべて') return 'このタブ名は使用できません';
    const extensions = normalizeExtensions(body.extensions);
    if (kindForTab(tab) === 'custom' && extensions.length === 0) {
      return 'カスタムタブには対象の拡張子を1つ以上指定してください';
    }
    return { tab, extensions };
  };

  app.post('/api/libraries', async (req, rep) => {
    const body = (req.body ?? {}) as {
      name?: string;
      tab?: string;
      extensions?: string[] | string;
      enabled?: boolean;
      paths?: unknown;
    };
    const name = (body.name ?? '').trim();
    if (!name) return rep.code(400).send({ error: 'name_required' });
    const meta = parseLibraryMeta(body);
    if (typeof meta === 'string') return rep.code(400).send({ error: meta });
    const paths = parsePaths(body.paths);
    if (typeof paths === 'string') return rep.code(400).send({ error: paths });
    const overlap = validateNoOverlap(paths);
    if (overlap) return rep.code(400).send({ error: overlap });
    try {
      const lib = createLibrary(db, {
        name,
        tab: meta.tab,
        extensions: meta.extensions,
        enabled: body.enabled,
        paths,
      });
      markLegacyDefaults(db, config);
      invalidateFolders();
      return lib;
    } catch (e) {
      const msg = (e as Error).message;
      return rep
        .code(400)
        .send({ error: msg.includes('UNIQUE') ? '同じ名前のライブラリが存在します' : msg });
    }
  });

  app.patch('/api/libraries/:id', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    if (!getLibrary(db, id)) return rep.code(404).send({ error: 'not_found' });
    const body = (req.body ?? {}) as {
      name?: string;
      tab?: string;
      extensions?: string[] | string;
      enabled?: boolean;
      paths?: unknown;
    };
    if (body.name !== undefined && body.name.trim() === '') {
      return rep.code(400).send({ error: 'name_required' });
    }
    let meta: { tab: string; extensions: string[] } | undefined;
    if (body.tab !== undefined || body.extensions !== undefined) {
      const parsedMeta = parseLibraryMeta(body);
      if (typeof parsedMeta === 'string') return rep.code(400).send({ error: parsedMeta });
      meta = parsedMeta;
    }
    let paths: PathInput[] | undefined;
    if (body.paths !== undefined) {
      const parsed = parsePaths(body.paths);
      if (typeof parsed === 'string') return rep.code(400).send({ error: parsed });
      paths = parsed;
      const overlap = validateNoOverlap(paths, id);
      if (overlap) return rep.code(400).send({ error: overlap });
    }
    try {
      const lib = updateLibrary(db, id, {
        name: body.name?.trim(),
        tab: meta?.tab,
        extensions: meta?.extensions,
        enabled: body.enabled,
        paths,
      });
      markLegacyDefaults(db, config);
      invalidateFolders();
      return lib;
    } catch (e) {
      const msg = (e as Error).message;
      return rep
        .code(400)
        .send({ error: msg.includes('UNIQUE') ? '同じ名前のライブラリが存在します' : msg });
    }
  });

  app.delete('/api/libraries/:id', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const lib = getLibrary(db, id);
    if (!lib) return rep.code(404).send({ error: 'not_found' });
    if (lib.is_default === 1) {
      return rep
        .code(400)
        .send({ error: '既定ライブラリは削除できません。無効化で対応してください' });
    }
    deleteLibrary(db, id);
    invalidateFolders();
    return { ok: true };
  });

  app.put('/api/libraries/order', async (req, rep) => {
    const ids = (req.body as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || !ids.every((v) => Number.isInteger(v))) {
      return rep.code(400).send({ error: 'ids は数値配列で指定してください' });
    }
    reorderLibraries(db, ids as number[]);
    invalidateFolders();
    return { ok: true };
  });

  const normalizeDrive = (v: string | null | undefined): string | null => {
    if (!v) return null;
    const s = v.replace(/\\$/, '').toUpperCase();
    return /^[A-Z]:$/.test(s) ? s : null;
  };

  app.get('/api/smb-connections', async () => ({ connections: listConnections(db) }));

  app.post('/api/smb-connections', async (req, rep) => {
    const body = (req.body ?? {}) as {
      name?: string;
      host?: string;
      share?: string;
      username?: string;
      password?: string;
      driveLetter?: string | null;
      autoMount?: boolean;
    };
    const name = (body.name ?? '').trim();
    const host = (body.host ?? '').trim();
    const share = (body.share ?? '').trim();
    const username = (body.username ?? '').trim();
    if (!name || !host || !share || !username) {
      return rep.code(400).send({ error: 'name / host / share / username は必須です' });
    }
    if (body.driveLetter && !normalizeDrive(body.driveLetter)) {
      return rep.code(400).send({ error: 'driveLetter は「Z:」形式で指定してください' });
    }
    try {
      if (body.password) await registerCredential(host, username, body.password);
      const conn = createConnection(db, {
        name,
        host,
        share,
        username,
        driveLetter: normalizeDrive(body.driveLetter),
        autoMount: body.autoMount,
      });
      return conn;
    } catch (e) {
      return rep.code(500).send({ error: (e as Error).message });
    }
  });

  app.patch('/api/smb-connections/:id', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const cur = getConnection(db, id);
    if (!cur) return rep.code(404).send({ error: 'not_found' });
    const body = (req.body ?? {}) as {
      name?: string;
      host?: string;
      share?: string;
      username?: string;
      password?: string;
      driveLetter?: string | null;
      autoMount?: boolean;
    };
    const host = (body.host ?? cur.host).trim();
    const username = (body.username ?? cur.username).trim();
    try {
      if (body.password) await registerCredential(host, username, body.password);
      const conn = updateConnection(db, id, {
        name: body.name?.trim(),
        host,
        share: body.share?.trim(),
        username,
        driveLetter:
          body.driveLetter === undefined ? undefined : normalizeDrive(body.driveLetter),
        autoMount: body.autoMount,
      });
      return conn;
    } catch (e) {
      return rep.code(500).send({ error: (e as Error).message });
    }
  });

  app.delete('/api/smb-connections/:id', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    if (!getConnection(db, id)) return rep.code(404).send({ error: 'not_found' });
    deleteConnection(db, id);
    return { ok: true };
  });

  app.post('/api/smb-connections/:id/test', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const conn = getConnection(db, id);
    if (!conn) return rep.code(404).send({ error: 'not_found' });
    return testConnection(conn);
  });

  const metaStmt = db.prepare('SELECT value FROM app_meta WHERE key = ?');
  const readMeta = (key: string): string | undefined =>
    (metaStmt.get(key) as { value: string } | undefined)?.value;
  const writeMeta = (key: string, value: string): void => {
    db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(key, value);
  };

  app.get('/api/system', async () => {
    return {
      appName: readMeta('app_name') ?? 'Kurarium',
      version: appVersion(),
      allowMixedMedia: readMeta('allow_mixed_media') === '1',
      onlySupportedVideos: readMeta('only_supported_videos') !== '0',
      scanOnStartup: readMeta('scan_on_startup') !== '0',
      port: config.server.port,
      host: config.server.host,
      basicAuthUser: config.server.basicAuthUser,
      hasBasicAuth: config.server.basicAuthPasswordHash.length > 0,
      authRequired: authEnabled(config.server),
      dataDir: dataDir(),
    };
  });

  app.patch('/api/system', async (req, rep) => {
    const body = (req.body ?? {}) as {
      appName?: string;
      allowMixedMedia?: boolean;
      onlySupportedVideos?: boolean;
      scanOnStartup?: boolean;
    };
    if (body.appName !== undefined) {
      const name = body.appName.trim();
      if (!name) return rep.code(400).send({ error: 'appName を入力してください' });
      writeMeta('app_name', name);
    }
    if (body.allowMixedMedia !== undefined) {
      writeMeta('allow_mixed_media', body.allowMixedMedia ? '1' : '0');
      // ライブラリ構成の集計キャッシュを破棄
      foldersCacheAt = 0;
    }
    if (body.onlySupportedVideos !== undefined) {
      writeMeta('only_supported_videos', body.onlySupportedVideos ? '1' : '0');
      foldersCacheAt = 0;
    }
    if (body.scanOnStartup !== undefined) {
      writeMeta('scan_on_startup', body.scanOnStartup ? '1' : '0');
    }
    return {
      appName: readMeta('app_name') ?? 'Kurarium',
      version: appVersion(),
      allowMixedMedia: readMeta('allow_mixed_media') === '1',
      onlySupportedVideos: readMeta('only_supported_videos') !== '0',
      scanOnStartup: readMeta('scan_on_startup') !== '0',
      host: config.server.host,
      basicAuthUser: config.server.basicAuthUser,
      hasBasicAuth: config.server.basicAuthPasswordHash.length > 0,
    };
  });
  // ロゴは同梱アセットから配信する
  app.get('/brand/logo.svg', async (_req, rep) => {
    const logoPath = logoFile();
    try {
      const data = await readFile(logoPath);
      rep.header('content-type', 'image/svg+xml; charset=utf-8');
      rep.header('cache-control', 'no-cache');
      return rep.send(data);
    } catch {
      return rep.code(404).send({ error: 'logo_not_found' });
    }
  });
  // ---- タグ/履歴 API ----

  app.get('/api/tags', async () => listTags(db));

  app.post('/api/tags', async (req, rep) => {
    const name = (req.body as { name?: string })?.name ?? '';
    if (!name.trim()) return rep.code(400).send({ error: 'name_required' });
    const tag = ensureTag(db, name);
    return tag;
  });

  app.delete('/api/tags/:id', async (req, rep) => {
    const ok = deleteTag(db, Number((req.params as { id: string }).id));
    if (!ok) return rep.code(404).send({ error: 'not_found' });
    return { deleted: true };
  });

  app.post('/api/items/:id/tags', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const name = (req.body as { name?: string })?.name ?? '';
    if (!name.trim()) return rep.code(400).send({ error: 'name_required' });
    const tags = addItemTag(db, id, name);
    if (tags === null) return rep.code(404).send({ error: 'not_found' });
    return { tags };
  });

  app.delete('/api/items/:id/tags', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { name?: string } | undefined;
    const name = body?.name ?? '';
    if (!name.trim()) return rep.code(400).send({ error: 'name_required' });
    const tags = removeItemTag(db, id, name);
    if (tags === null) return rep.code(404).send({ error: 'not_found' });
    return { tags };
  });

  app.post('/api/tags/apply-rules', async () => {
    return applyTagRules(db, config.tags.rules);
  });

  app.post('/api/items/:id/history', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const item = getMediaItem(db, id);
    if (!item) return rep.code(404).send({ error: 'not_found' });
    recordView(db, id, Date.now());
    return { ok: true };
  });

  app.post('/api/items/:id/resume', async (req, rep) => {
    const id = Number((req.params as { id: string }).id);
    const position = Number((req.body as { position?: number })?.position);
    if (!Number.isFinite(position) || position < 0) {
      return rep.code(400).send({ error: 'position_required' });
    }
    saveResumePosition(db, id, position);
    return { ok: true };
  });

  app.get('/api/history', async (req, rep) => {
    const qp = req.query as Record<string, string | undefined>;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(qp.limit ?? DEFAULT_LIMIT)));
    const offset = Math.max(0, Number(qp.cursor ?? 0));
    const rows = recentHistory(db, limit + 1, offset);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    attachTagsToRows(db, items);
    return rep.send({
      items,
      nextCursor: hasMore ? offset + items.length : null,
    });
  });

  app.get('/api/items/:id/play', async (req, rep) => {
    const item = getMediaItem(db, Number((req.params as { id: string }).id));
    if (!item) return rep.code(404).send({ error: 'not_found' });
    if (item.type !== 'video') return rep.code(400).send({ error: 'not_a_video' });
    const st = transcodeStatus(db, item.id);
    // HEVC などネイティブ試行後に強制変換が要求された動画は変換済み配信へ繋ぐ
    const native = isNativePlayable(item) && st.mode !== 'encode';
    return {
      id: item.id,
      kind: native ? 'native' : 'transcode',
      url: native ? `/api/items/${item.id}/file` : `/api/items/${item.id}/transcoded`,
      transcode: { status: st.status, progress: st.progress, message: st.message, mode: st.mode },
      item,
    };
  });

  app.post('/api/items/:id/transcode', async (req, rep) => {
    const item = getMediaItem(db, Number((req.params as { id: string }).id));
    if (!item) return rep.code(404).send({ error: 'not_found' });
    if (item.type !== 'video') return rep.code(400).send({ error: 'not_a_video' });
    const force = Boolean((req.body as { force?: boolean })?.force);
    if (isNativePlayable(item) && !force) {
      return { status: 'not_needed' };
    }
    try {
      const entry = requestTranscode(db, item.id, force);
      return { status: entry.status, progress: entry.progress };
    } catch (e) {
      return rep.code(500).send({ error: (e as Error).message });
    }
  });

  app.get('/api/items/:id/transcode/status', async (req, rep) => {
    const item = getMediaItem(db, Number((req.params as { id: string }).id));
    if (!item) return rep.code(404).send({ error: 'not_found' });
    const st = transcodeStatus(db, item.id);
    return { status: st.status, progress: st.progress, message: st.message, mode: st.mode };
  });

  app.get('/api/items/:id/transcoded', async (req, rep) => {
    const row = db
      .prepare("SELECT path FROM transcode_cache WHERE media_id = ? AND status = 'ready'")
      .get(Number((req.params as { id: string }).id)) as { path: string } | undefined;
    if (!row || !row.path) return rep.code(404).send({ error: 'transcode_not_ready' });
    let fileSize: number;
    try {
      fileSize = (await stat(row.path)).size;
    } catch {
      return rep.code(410).send({ error: 'transcode_file_missing' });
    }
    const mime = row.path.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
    return sendRange(rep, row.path, fileSize, mime);
  });

  app.post('/api/scan', async (req) => {
    const mode = (req.body as { mode?: string })?.mode === 'full' ? 'full' : 'diff';
    void scanAll(db, config, mode)
      .then((summary) => {
        if (!summary.error) {
          void cleanupOrphanThumbs(db);
          startThumbQueue(db);
        }
      })
      .catch(() => undefined);
    return { started: true, mode, scan: scanStatus() };
  });

  app.get('/api/scan/status', async () => {
    const counts = db
      .prepare(
        'SELECT type, status, thumb_status, COUNT(*) AS count FROM media_items GROUP BY type, status, thumb_status',
      )
      .all();
    return { scan: scanStatus(), thumbs: thumbStatus(), counts };
  });

  app.get('/api/server-settings', async () => {
    const saved = existsSync(configIniPath())
      ? loadConfig(configIniPath())
      : { server: config.server };
    return {
      host: saved.server.host,
      port: saved.server.port,
      basicAuthUser: saved.server.basicAuthUser,
      hasBasicAuth: saved.server.basicAuthPasswordHash.length > 0,
    };
  });
  // サーバー設定(Web UIから保存。秘密情報はハッシュのみを隠しファイルへ保存)
  app.put('/api/server-settings', async (req, rep) => {
    const body = (req.body ?? {}) as {
      host?: string;
      port?: number | string;
      basicAuthUser?: string;
      basicAuthPassword?: string;
    };
    const host = (body.host ?? '').trim() || '127.0.0.1';
    const port = Number(body.port ?? config.server.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return rep.code(400).send({ error: 'ポートは 1〜65535 の整数で指定してください' });
    }
    const user = (body.basicAuthUser ?? '').trim();
    const password = body.basicAuthPassword ?? '';
    if (password && !user) {
      return rep
        .code(400)
        .send({ error: 'ログイン用パスワードを設定する場合はユーザー名も入力してください' });
    }
    // パスワード未入力時は既存ハッシュを維持。ユーザー名を空にした場合は認証設定を解除する
    const passwordHash = password
      ? hashPassword(password)
      : user
        ? config.server.basicAuthPasswordHash
        : '';
    if (!isLoopbackHost(host) && (!user || !passwordHash)) {
      return rep
        .code(400)
        .send({ error: 'LAN公開にはログイン用のユーザー名とパスワードが必要です' });
    }
    try {
      writeServerConfig({
        port,
        host,
        basicAuthUser: user,
        basicAuthPasswordHash: passwordHash,
      });
    } catch (e) {
      return rep.code(500).send({ error: (e as Error).message });
    }
    return {
      ok: true,
      restartRequired: true,
      host,
      port,
      basicAuthUser: user,
      hasBasicAuth: passwordHash.length > 0,
    };
  });
  // フロントエンド(ビルド済み)の静的配信
  const distDir = webDistDir();
  const indexFile = join(distDir, 'index.html');
  if (existsSync(indexFile)) {
    await app.register(fastifyStatic, { root: distDir, wildcard: false });
    app.setNotFoundHandler(async (req, rep) => {
      if (req.url.startsWith('/api/')) {
        return rep.code(404).send({ error: 'not_found' });
      }
      return rep.type('text/html').send(createReadStream(indexFile));
    });
  } else {
    app.get('/', async () => ({
      message: 'Kurarium API は起動しています。フロントエンドは未ビルドです。',
      hint: 'frontend/ で npm run build を実行してください',
    }));
  }

  return app;
}
