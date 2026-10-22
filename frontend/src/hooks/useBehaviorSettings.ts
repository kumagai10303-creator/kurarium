import { useCallback, useState } from 'react';

export type FolderTileAspect =
  | 'thumb'
  | '1:1'
  | '4:3'
  | '3:2'
  | '16:9'
  | '3:4'
  | '2:3'
  | '9:16'
  | 'custom';

/** 一覧のレイアウトテンプレート */
export type ListLayout = 'thumb' | 'detail' | 'cards';

export interface BehaviorSettings {
  /** 動画サムネイルのホバー自動再生 */
  hoverPreview: boolean;
  /** ホイールでのライトボックス前後切替 */
  wheelNavigate: boolean;
  /** ダブルクリックでの全画面切替 */
  doubleClickFullscreen: boolean;
  /** 閲覧履歴を残す */
  keepHistory: boolean;
  /** サムネのみレイアウトで行の高さにゆらぎをつける */
  rowWobble: boolean;
  /** フォルダタイルの高さ(px) */
  folderTileHeight: number;
  /** フォルダタイルの形(thumb=サムネイル比 / それ以外は固定アスペクト) */
  folderTileAspect: FolderTileAspect;
  /** カスタム比率の横 */
  folderTileAspectW: number;
  /** カスタム比率の縦 */
  folderTileAspectH: number;
  /** ギャラリーサムネイルの高さ(px): すべて/履歴 */
  thumbHeight: number;
  /** 画像タブのサムネイル高さ(px) */
  thumbHeightImage: number;
  /** 動画タブのサムネイル高さ(px) */
  thumbHeightVideo: number;
  /** PDFタブのサムネイル高さ(px) */
  thumbHeightPdf: number;
  /** 音楽タブのサムネイル高さ(px) */
  thumbHeightMusic: number;
  /** 一覧レイアウト: すべて */
  layoutAll: ListLayout;
  /** 一覧レイアウト: 画像 */
  layoutImage: ListLayout;
  /** 一覧レイアウト: 動画 */
  layoutVideo: ListLayout;
  /** 一覧レイアウト: PDF */
  layoutPdf: ListLayout;
  /** 一覧レイアウト: 音楽 */
  layoutMusic: ListLayout;
  /** 一覧レイアウト: 履歴 */
  layoutHistory: ListLayout;
}

const DEFAULTS: BehaviorSettings = {
  hoverPreview: true,
  wheelNavigate: true,
  doubleClickFullscreen: true,
  keepHistory: true,
  rowWobble: true,
  folderTileHeight: 200,
  folderTileAspect: '1:1',
  folderTileAspectW: 4,
  folderTileAspectH: 3,
  thumbHeight: 280,
  thumbHeightImage: 280,
  thumbHeightVideo: 280,
  thumbHeightPdf: 280,
  thumbHeightMusic: 280,
  layoutAll: 'thumb',
  layoutImage: 'thumb',
  layoutVideo: 'thumb',
  layoutPdf: 'thumb',
  layoutMusic: 'detail',
  layoutHistory: 'thumb',
};

const STORAGE_KEY = 'nmv-settings';

function load(): BehaviorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<BehaviorSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function useBehaviorSettings(): [
  BehaviorSettings,
  (patch: Partial<BehaviorSettings>) => void,
] {
  const [settings, setSettings] = useState<BehaviorSettings>(load);
  const update = useCallback((patch: Partial<BehaviorSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 保存できない環境でも実行中の挙動は変更する
      }
      return next;
    });
  }, []);
  return [settings, update];
}
