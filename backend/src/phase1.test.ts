import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type AppConfig } from './config.js';
import { openDb, thumbDir, type DB } from './db.js';
import { scanFolder, classifyFile } from './scanner.js';
import { buildApp } from './routes.js';
import type { FastifyInstance } from 'fastify';

let root: string;
let db: DB;
let config: AppConfig;
let app: FastifyInstance;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'bhv-phase1-'));
  process.env.MEDIAVIEWER_DATA_DIR = join(root, 'data');
  const imageDir = join(root, 'Pics', 'sub');
  const videoDir = join(root, 'Vids');
  mkdirSync(imageDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });

  // テスト用画像: 8x16 PNG を生成して配置
  const { default: sharp } = await import('sharp');
  const png = await sharp({ create: { width: 8, height: 16, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
  writeFileSync(join(root, 'Pics', 'a.png'), png);
  writeFileSync(join(imageDir, 'b.jpg'), png);
  writeFileSync(join(imageDir, 'c.gif'), png);
  writeFileSync(join(root, 'Pics', 'ignore.txt'), 'txt');

  // 小さなテスト動画 (ffmpeg testsrc)
  const { spawn } = await import('node:child_process');
  const genVideo = (src: string, extra: string[]) =>
    new Promise<void>((resolve, reject) => {
      const p = spawn('ffmpeg', [
        '-v', 'error',
        '-f', 'lavfi', '-i', 'testsrc=duration=2:size=128x96:rate=10',
        ...extra,
        '-y', src,
      ]);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed'))));
    });
  await genVideo(join(videoDir, 'test.mp4'), ['-pix_fmt', 'yuv420p']);
  // コンテナだけ非対応の FLV(h264)を用意 → リマックスで再生可能になる経路の確認用
  await genVideo(join(videoDir, 'test.flv'), ['-vcodec', 'libx264', '-pix_fmt', 'yuv420p', '-an']);

  const iniPath = join(root, 'config.ini');
  writeFileSync(
    iniPath,
    [
      '[smb]',
      'host = h',
      'share = s',
      'auto_mount = false',
      '[media]',
      `image_folders = Pics`,
      `video_folders = Vids`,
      '[server]',
      'port = 3999',
      '',
    ].join('\n'),
    'utf-8',
  );
  config = loadConfig(iniPath);
  // パス解決をテスト用一時ディレクトリへ向ける
  config.smb.driveLetter = root;
  db = openDb(join(root, 'test.db'));
  app = await buildApp({ config, db });
  await mkdir(thumbDir(), { recursive: true });
});

afterAll(() => {
  db.close();
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

void stat;

describe('classifyFile', () => {
  it('拡張子分類', () => {
    expect(classifyFile('.jpg')).toBe('image');
    expect(classifyFile('.MP4')).toBe('video');
    expect(classifyFile('.ts')).toBe('video');
    expect(classifyFile('.txt')).toBeNull();
  });
});

describe('scanFolder', () => {
  let images: { inserted: number; total: number };

  it('画像フォルダを走査して登録する', async () => {
    images = await scanFolder(db, config, 'Pics', 'image', 1000);
    expect(images.total).toBe(3);
    expect(images.inserted).toBe(3);
  });

  it('動画フォルダを走査して登録する', async () => {
    const r = await scanFolder(db, config, 'Vids', 'video', 1000);
    // test.flv + test.mp4
    expect(r.total).toBe(2);
  });

  it('再スキャンで増分なし・削除検出', async () => {
    const same = await scanFolder(db, config, 'Pics', 'image', 2000);
    expect(same.inserted).toBe(0);
    expect(same.updated).toBe(0);
    expect(same.removed).toBe(0);

    rmSync(join(root, 'Pics', 'a.png'));
    const afterDelete = await scanFolder(db, config, 'Pics', 'image', 3000);
    expect(afterDelete.removed).toBe(1);
    const gone = db
      .prepare("SELECT status FROM media_items WHERE file_name = 'a.png'")
      .get() as { status: string };
    expect(gone.status).toBe('missing');
  });
});

describe('API', () => {
  it('GET /api/items で paging が機能する', async () => {
    const r1 = await app.inject('/api/items?type=image&limit=1');
    expect(r1.statusCode).toBe(200);
    const b1 = r1.json();
    expect(b1.items).toHaveLength(1);
    expect(b1.nextCursor).not.toBeNull();
    const r2 = await app.inject(
      `/api/items?type=image&limit=1&cursor=${b1.nextCursor}`,
    );
    const b2 = r2.json();
    expect(b2.items).toHaveLength(1);
    expect(b2.nextCursor).toBeNull();
  });

  it('GET /api/items/:id で詳細取得・404', async () => {
    const first = (
      db.prepare('SELECT id FROM media_items LIMIT 1').get() as { id: number }
    ).id;
    const ok = await app.inject(`/api/items/${first}`);
    expect(ok.statusCode).toBe(200);
    const ng = await app.inject('/api/items/99999');
    expect(ng.statusCode).toBe(404);
  });

  it('video に duration と thumbnail が生成される', async () => {
    const { processThumb, thumbPath } = await import('./thumbnails.js');
    const v = db
      .prepare("SELECT * FROM media_items WHERE type='video' LIMIT 1")
      .get() as { id: number; duration: number | null; thumb_status: string };
    await processThumb(db, v.id);
    const after = db.prepare('SELECT * FROM media_items WHERE id=?').get(v.id) as {
      duration: number | null;
      width: number | null;
      thumb_status: string;
    };
    expect(after.thumb_status).toBe('ready');
    expect(after.duration).toBeGreaterThan(0);
    expect(after.width).toBe(128);
    expect(existsSync(thumbPath(v.id))).toBe(true);
  });

  it('画像に thumbnail が生成され、配信できる', async () => {
    const { processThumb } = await import('./thumbnails.js');
    const img = db
      .prepare("SELECT * FROM media_items WHERE type='image' LIMIT 1")
      .get() as { id: number };
    await processThumb(db, img.id);
    const thumb = await app.inject(`/api/items/${img.id}/thumbnail`);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toContain('image/webp');
  });

  it('GET /api/items/:id/file で Range 配信が機能する', async () => {
    const img = db
      .prepare("SELECT * FROM media_items WHERE type='image' LIMIT 1")
      .get() as { id: number; path: string };

    const full = await app.inject(`/api/items/${img.id}/file`);
    expect(full.statusCode).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');

    const part = await app.inject({
      url: `/api/items/${img.id}/file`,
      headers: { range: 'bytes=0-9' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-length']).toBe('10');
    expect(part.headers['content-range']).toMatch(/^bytes 0-9\//);

    const tail = await app.inject({
      url: `/api/items/${img.id}/file`,
      headers: { range: 'bytes=-5' },
    });
    expect(tail.statusCode).toBe(206);

    const bad = await app.inject({
      url: `/api/items/${img.id}/file`,
      headers: { range: 'bytes=99999999-' },
    });
    expect(bad.statusCode).toBe(416);
  });
});

describe('Phase4: タグ', () => {
  let targetId: number;

  it('タグの追加・一覧・重複なし作成', async () => {
    const first = (db.prepare('SELECT id FROM media_items LIMIT 1').get() as { id: number }).id;
    targetId = first;

    const r1 = await app.inject({
      method: 'POST',
      url: `/api/items/${targetId}/tags`,
      payload: { name: 'テスト' },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().tags).toEqual(['テスト']);

    const dup = await app.inject({
      method: 'POST',
      url: `/api/items/${targetId}/tags`,
      payload: { name: 'テスト' },
    });
    expect(dup.json().tags).toEqual(['テスト']);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number }).c;
    expect(count).toBe(1);

    // 大文字小文字・NOCASE
    const nocase = await app.inject({
      method: 'POST',
      url: `/api/items/${targetId}/tags`,
      payload: { name: 'テスト'.toUpperCase() },
    });
    expect(nocase.json().tags.length).toBe(1);
  });

  it('タグ一覧と削除', async () => {
    const list = await app.inject('/api/tags');
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].count).toBe(1);

    const del = await app.inject({ method: 'DELETE', url: '/api/tags/99999' });
    expect(del.statusCode).toBe(404);
  });

  it('アイテムからタグを削除', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/items/${targetId}/tags`,
      payload: { name: 'テスト' },
    });
    expect(r.json().tags).toEqual([]);
  });

  it('ルールによる自動タグ付け', async () => {
    const { applyTagRules } = await import('./tags.js');
    // ファイル名 test.mp4 にマッチするルール
    const res = applyTagRules(db, [{ match: 'test', tag: 'auto' }]);
    expect(res.applied).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare(
        "SELECT COUNT(*) AS c FROM media_tags mt JOIN tags t ON t.id=mt.tag_id WHERE t.name='auto'",
      )
      .get() as { c: number };
    expect(row.c).toBeGreaterThanOrEqual(1);
  });

  it('タグ絞り込み検索', async () => {
    // video に auto タグが付いているはず(search もできる)
    const r = await app.inject('/api/items?tags=auto');
    expect(r.statusCode).toBe(200);
    const items = r.json().items as { id: number; tags?: string[] }[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].tags).toContain('auto');
    const none = await app.inject('/api/items?tags=存在しないタグ');
    expect((none.json() as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe('Phase4: 検索・履歴', () => {
  it('FTS5 ファイル名検索', async () => {
    const r = await app.inject('/api/items?q=test');
    expect(r.statusCode).toBe(200);
    const items = r.json().items as { file_name: string }[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((i) => i.file_name.includes('test'))).toBe(true);
    const none = await app.inject('/api/items?q=存在しないファイル名xyz');
    expect((none.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('FTS 併用時のページング(offsetベース)', async () => {
    const r1 = await app.inject('/api/items?q=test&limit=1');
    const b1 = r1.json();
    expect(b1.items).toHaveLength(1);
    if (b1.nextCursor !== null) {
      const r2 = await app.inject(`/api/items?q=test&limit=1&cursor=${b1.nextCursor}`);
      const all = [...b1.items, ...r2.json().items];
      const seen = new Set(all.map((i: { id: number }) => i.id));
      expect(seen.size).toBe(all.length);
    }
  });

  it('履歴記録と閲覧数カウント', async () => {
    const v = db
      .prepare("SELECT id, view_count FROM media_items WHERE type='video' LIMIT 1")
      .get() as { id: number; view_count: number };
    const r = await app.inject({ method: 'POST', url: `/api/items/${v.id}/history` });
    expect(r.statusCode).toBe(200);

    const after = db.prepare('SELECT view_count, last_viewed_at FROM media_items WHERE id=?').get(v.id) as {
      view_count: number;
      last_viewed_at: number | null;
    };
    expect(after.view_count).toBe(v.view_count + 1);
    expect(after.last_viewed_at).not.toBeNull();

    // 10分以内の再記録は1件にまとまる
    const historyCount = (
      db.prepare('SELECT COUNT(*) AS c FROM browsing_history WHERE media_id=?').get(v.id) as { c: number }
    ).c;
    await app.inject({ method: 'POST', url: `/api/items/${v.id}/history` });
    const historyCount2 = (
      db.prepare('SELECT COUNT(*) AS c FROM browsing_history WHERE media_id=?').get(v.id) as { c: number }
    ).c;
    expect(historyCount2).toBe(historyCount);
  });

  it('GET /api/history で履歴一覧', async () => {
    const r = await app.inject('/api/history');
    expect(r.statusCode).toBe(200);
    const items = r.json().items as { last_viewed_at: number; id: number }[];
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('再生位置の保存(終端直前はリセット)', async () => {
    // duration が未取得済みサムネの場合に備えて先に取得しておく
    const { processThumb } = await import('./thumbnails.js');
    const v = db
      .prepare("SELECT id FROM media_items WHERE file_name LIKE '%test.mp4' LIMIT 1")
      .get() as { id: number };
    await processThumb(db, v.id);
    const save = await app.inject({
      method: 'POST',
      url: `/api/items/${v.id}/resume`,
      payload: { position: 1.5 },
    });
    expect(save.statusCode).toBe(200);
    const saved = db.prepare('SELECT resume_position FROM media_items WHERE id=?').get(v.id) as {
      resume_position: number | null;
    };
    expect(saved.resume_position).toBe(1.5);

    // duration=2 の動画で position=1.99 → ほぼ終端なので 0 にリセット
    await app.inject({
      method: 'POST',
      url: `/api/items/${v.id}/resume`,
      payload: { position: 1.99 },
    });
    const reset = db.prepare('SELECT resume_position FROM media_items WHERE id=?').get(v.id) as {
      resume_position: number | null;
    };
    expect(reset.resume_position).toBe(0);
  });

  it('タグ削除APIが機能する', async () => {
    // auto タグを作って削除
    const tag = db.prepare("SELECT id FROM tags WHERE name='auto'").get() as { id: number };
    const del = await app.inject({ method: 'DELETE', url: `/api/tags/${tag.id}` });
    expect(del.statusCode).toBe(200);
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM tags WHERE id=?').get(tag.id) as {
      c: number;
    };
    expect(remaining.c).toBe(0);
  });
});

describe('Phase5: リマックス変換', () => {
  it('FLV(h264) はリマックスで高速に MP4 化される', async () => {
    // サムネイル処理で vcodec を取得
    const { processThumb } = await import('./thumbnails.js');
    const flv = db
      .prepare("SELECT * FROM media_items WHERE file_name LIKE '%test.flv' LIMIT 1")
      .get() as { id: number; vcodec: string | null } | undefined;
    expect(flv).toBeTruthy();
    await processThumb(db, flv!.id);
    const after = db.prepare('SELECT vcodec FROM media_items WHERE id=?').get(flv!.id) as {
      vcodec: string | null;
    };
    expect(after.vcodec).toBe('h264');

    // /play は native ではない(kind=transcode)
    const play = await app.inject(`/api/items/${flv!.id}/play`);
    expect(play.json().kind).toBe('transcode');

    // 変換要求 → リマックスで ready になることを確認
    const { requestTranscode } = await import('./transcode.js');
    const entry = requestTranscode(db, flv!.id);
    expect(entry.status).toBe('queued');
    const tillDone = async () => {
      for (let i = 0; i < 100; i++) {
        const st = requestTranscode(db, flv!.id);
        if (st.status === 'ready' || st.status === 'failed') return st;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('transcode timeout');
    };
    const done = await tillDone();
    expect(done.status).toBe('ready');

    // 変換済み MP4 が配信される
    const out = await app.inject(`/api/items/${flv!.id}/transcoded`);
    expect(out.statusCode).toBe(200);
  });

  it('force 再要求はエンコードモードで作り直す', async () => {
    // ready 行を force で上書き
    const { requestTranscode } = await import('./transcode.js');
    const v = db
      .prepare("SELECT id FROM media_items WHERE type='video' LIMIT 1")
      .get() as { id: number };
    const entry = requestTranscode(db, v.id, true);
    expect(entry.mode).toBe('encode');
    expect(entry.status).toBe('queued');
    // バックグラウンドの変換が終わるのを待ってからテストを閉じる
    for (let i = 0; i < 100; i++) {
      const st = requestTranscode(db, v.id);
      if (st.status === 'ready' || st.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});

