# NAS メディアビューア 仕様書・作業プラン

## 1. 概要

NAS(SMBマウントしたネットワークドライブ)上の画像・動画ファイルを、Windows PC 上の Node.js サーバー経由でブラウザ閲覧するアプリケーションを開発する。

- 画像 → **pixiv ライク** UI(サムネイルグリッド / 作品ビュー / タグ)
- 動画 → **YouTube ライク** UI(サムネイルグリッド / 視聴ページ / 関連動画)
- LAN 内のブラウザからアクセス(単一ユーザー想定、認証はスコープ外)

## 2. 前提条件

| 項目 | 内容 |
|---|---|
| NAS アクセス | Windows PC に SMB ドライブとしてマウント済み(例: `Z:\`) |
| サーバー環境 | Windows PC + Node.js(常駐) |
| 規模 | 数万〜数十万件 |
| ブラウザ | モダンブラウザ(Chrome / Edge / Firefox) |
| 対応動画形式 | mp4(H.264/AAC)ネイティブ再生。mkv 等はトランスコード |
| 書き込み | ビューアは読み取り専用(LIB 内のファイルは変更しない) |

## 3. 全体アーキテクチャ

```
[SMBドライブ Z:\]
      │ ファイル走査
[Node.js サーバー (Fastify)]
  ├─ インデクサ: ファイル走査 → SQLite 登録(増分・期間スキャン)
  ├─ サムネイル ジョブキュー: sharp(画像)/ ffmpeg(動画) → キャッシュ
  ├─ メディア配信: Range 対応のストリーミング / トランスコード配信
  ├─ REST API: 一覧・検索・タグ・履歴
      │
[vite + React SPA]
  ├─ pixiv 風ギャラリー画面
  └─ YouTube 風動画セクション
```

## 4. 機能仕様

### 4.1 共通

- **ライブラリ登録**: NAS ルート配下のフォルダを複数登録可能(画像用/動画用を分ける)
- **インデクシング**: 増分スキャン(パス/サイズ/mtime 変更のみ再処理)。重い処理(サムネイル)はバックグラウンドジョブキューで非同期化し、UI は即座に一覧を返す
- **検索**: ファイル名・タグの全文検索(SQLite FTS5)。タグ絞り込み(AND/OR)
- **タグ**: タグ追加/削除/一覧、自動付与設定(フォルダ名→タグのルール)
- **履歴**: 閲覧日時・回数を記録。「最近見た作品」ページ
- **ソート**: 更新日時・ファイル名・ランダム・お気に入り
- **ページング**: 無限スクロール(cursor ベース、1回あたり 50〜100 件)

### 4.2 画像(pixiv ライク)

- **一覧画面**: サムネイルグリッド(masonry 風)、ホバーで拡大情報/ファイル名、無限スクロール
- **作品ビュー**: クリックで拡大(全画面オーバーレイ or 専用ページ)
  - ←/→ キー・スワイプで前後の画像へ
  - ズーム(ホイール・ダブルクリック)、オリジナルサイズ表示
  - 下部にタグ、閲覧履歴表示
- 連番 scraped フォルダ(1 作品=複数枚)のような構成は将来的に「漫画モード」として対応(Phase 2 では 1 ファイル=1 作品)

### 4.3 動画(YouTube ライク)

- **一覧画面**: 16:9 サムネイルグリッド+再生時間バッジ、タイトル、検索バー、タグカテゴリチップ
- **視聴ページ**:
  - HTML5 `<video>` プレイヤー(コントロールバー・シーク・音量・全画面)
  - タイトル・タグ・解像度/再生時間情報
  - **再生位置の記憶**: 再開ダイアログ/自動再開(YouTube 挙動)
  - 関連動画サイドバー(同タグ・同フォルダ)
- **トランスコード**:
  - ネイティブ再生可(mp4/H.264/AAC)→ 直接ストリーミング(Range 対応)
  - 非対応(mkv/AVI等)→ ffmpeg で **MP4(H.264/AAC, faststart)へ変換してキャッシュ**(視聴時にキック、変換中はプレースホルダ→完了で自動切替)

### 4.4 非機能要件

- 数十万件でも一覧を数秒以内に表示(SQLite インデックス+ページング)
- サムネイルは小サイズ(WebP)をローカルキャッシュし、NAS への負荷を低減
- 大きなファイルは Range リクエストによる逐次配信(NAS→サーバー→ブラウザ)
- サーバーは Windows 起動時に自動起動(nssm タスクスケジューラ等、Phase 5)

## 5. 技術スタック

| レイヤ | 技術 |
|---|---|
| フロントエンド | React 18 + TypeScript + Vite |
| UI | Tailwind CSS(チェック済みデザインで迅速な UI 構築) |
| バックエンド | Node.js + TypeScript + Fastify |
| DB | SQLite (better-sqlite3) + FTS5 |
| 画像処理 | sharp(サムネイル生成/WebP 変換) |
| 動画処理 | ffmpeg(ffmpeg-static 同梱 or 別インストール) |
| ファイル監視 | chokidar / スキャンドリブン |
| API | REST(JSON) |
| テスト | vitest(API/変換ロジック中心) |

## 6. データモデル(SQLite)

```
media_items(
  id, type('image'|'video'), path UNIQUE, file_name, size, width, height,
  duration, mtime, added_at, thumb_status, trancode_status nullable, rating,
  view_count, last_viewed_at, resume_position
)
tags(id, name UNIQUE)
media_tags(media_id, tag_id)
browsing_history(id, media_id, viewed_at)
transcode_cache(media_id, path, status, generated_at, size)
```

## 7. API 設計(概要)

```
GET  /api/items?type=&tags=&q=&sort=&cursor=        一覧/検索
GET  /api/items/:id                                  詳細
GET  /api/items/:id/thumbnail                        サムネイル
GET  /api/items/:id/file                             原本ストリーム(Range対応)
POST /api/items/:id/transcode                        トランスコード要求
GET  /api/items/:id/transcode/status                 変換状況
POST /api/tags | DELETE /api/tags/:id                タグ管理
POST /api/items/:id/history                          履歴/再生位置記録
POST /api/scan                                       手動再スキャン
GET  /api/scan/status                                スキャン/変換キュー状況
```

## 8. 作業プラン

### Phase 0: 準備(0.5日)
- [ ] Node.js / pnpm 環境構築、ffmpeg インストール確認
- [ ] NAS マウントパスの設定ファイル化(`.env`)
- [ ] モノレポ雛形(frontend/ backend/)、lint・型チェック整備

### Phase 1: バックエンド基盤(2〜3日)
- [ ] SQLite スキーマ+マイグレーション
- [ ] ファイルスキャナ(画像/動画を拡張子判別し差分登録)
- [ ] サムネイルジョブキュー(sharp / ffmpeg)
- [ ] Range 対応メディア配信 API
- [ ] vitest によるスキャナ/API のテスト

### Phase 2: 画像ギャラリー(pixiv 風)(2〜3日)
- [ ] 一覧グリッド+無限スクロール
- [ ] 拡大ビュー(前後ナビ・ズーム)
- [ ] タグ表示/検索バー
- **検証**: 1万件規模のダミーデータでページング性能確認

### Phase 3: 動画(YouTube 風)(3〜4日)
- [ ] 一覧グリッド+再生時間バッジ
- [ ] 視聴ページ+再生位置の記憶
- [ ] ffmpeg 変換パイプライン(mkv → mp4 キャッシュ)
- [ ] 関連動画サイドバー
- **検証**: 大容量 mkv の変換とシーク動作

### Phase 4: タグ/検索/履歴(2日)
- [ ] FTS5 検索(ファイル名・タグ)、タグ絞り込み AND/OR
- [ ] タグ管理 UI(付与/解除/一覧)
- [ ] 閲覧履歴画面、お気に入り
- [ ] フォルダ名→タグの自動ルール

### Phase 5: 仕上げ(1〜2日)
- [ ] パフォーマンスチューニング(数十万件での負荷確認)
- [ ] 自動起動設定、エラーログ保守
- [ ] 使い方ドキュメント(README)

**合計目安: 10〜14 日**

## 9. 未確定事項 / 後日確認

- 1 作品=複数画像の「漫画モード」を二期で対応するかどうか
- 形式がどれくらいの割合か(mkv が多いなら変換キューの優先度設計を調整)
- モバイル/タブレット対応要否
- ffmpeg 同梱(ffmpeg-static)と別インストールのどちらにするか
