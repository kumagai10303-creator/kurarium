# Kurarium 0.1.0

Windows 10 22H2 / Windows 11 (x64) 向けの初回リリースです。

## ダウンロード

- `Kurarium-Setup-0.1.0.exe`: インストーラ(管理者権限不要)
- `Kurarium-0.1.0-win-x64.zip`: ポータブル版
- `SHA256SUMS.txt`: SHA-256 チェックサム
- `LEGAL-NOTICES.zip`: ライセンス全文、第三者表記、FFmpegのソース情報

## 未署名について

このリリースは**コード署名されていません**。Windows SmartScreen が
「Windows によって PC が保護されました」と表示する場合があります。

SHA-256 が `SHA256SUMS.txt` と一致することを確認したうえで、
**詳細情報 > 実行** を選択してください。

```powershell
Get-FileHash .\Kurarium-Setup-0.1.0.exe -Algorithm SHA256
```

## 主な機能

- ローカル/SMBの画像・動画・PDF・音楽ライブラリ
- トレイ常駐、自動起動(初期OFF)、単一インスタンス
- 起動時の差分スキャン、サムネイル生成、動画変換
- LAN公開時のセッションログイン
- ポータブル版はEXE隣の `data` に保存

## データの保存先

- インストール版: `%LOCALAPPDATA%\Kurarium\data`
- ポータブル版: 展開先の `data`

アンインストールしてもユーザーデータは残ります。バックアップはアプリ終了後に
上記フォルダをコピーしてください。

## 既知の制限

- コード署名は未対応です。
- 自動更新はありません。更新はReleaseから手動で行ってください。
- LAN公開はHTTPです。信頼できるネットワークでのみ使用してください。
- Windows 10 22H2実機での検証は未実施です(Windows 11で検証)。

## ライセンス

Kurarium本体はMIT Licenseです。同梱コンポーネントは各ライセンスに従います。
詳細は `LEGAL-NOTICES.zip` を参照してください。
