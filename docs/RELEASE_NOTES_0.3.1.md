# Kurarium 0.3.1

Windows 10 22H2 / Windows 11 (x64) 向けの修正リリースです。

## ダウンロード

- `Kurarium-Installer-0.3.1-win-x64.exe`: インストーラ(管理者権限不要)
- `Kurarium-Portable-0.3.1-win-x64.zip`: ポータブル版
- `SHA256SUMS.txt`: SHA-256 チェックサム
- `LEGAL-NOTICES.zip`: ライセンス全文、第三者表記、FFmpegのソース情報

## 修正内容

- SMB接続の保存前にNTLMv2で接続テストを実行
  - Windows資格情報マネージャーを変更せずに認証と共有アクセスを確認
  - 成功した場合のみ接続情報を保存
  - `STATUS_LOGON_FAILURE`になるNTLMv1依存を解消
- スキャン完了後にフォルダ件数を自動更新
  - 初期設定直後に件数が0件のままになる問題を修正
- サムネイル生成中のUIカクツキを改善
  - 進捗集計をDB集計からメモリ管理へ変更
  - 毎秒の重い集計クエリを廃止
  - Sharpの並列スレッド数を抑制
  - サムネイル書き込みをDBへ集約

## 未署名について

このリリースは**コード署名されていません**。Windows SmartScreen が
「Windows によって PC が保護されました」と表示する場合があります。

SHA-256 が `SHA256SUMS.txt` と一致することを確認したうえで、
**詳細情報 > 実行** を選択してください。

```powershell
Get-FileHash .\Kurarium-Installer-0.3.1-win-x64.exe -Algorithm SHA256
```

## データについて

既存のライブラリ設定・視聴履歴・サムネイルはそのまま引き継がれます。

- インストール版: `%LOCALAPPDATA%\Kurarium\data`
- ポータブル版: 展開先の `data`

## 既知の制限

- コード署名は未対応です。
- 自動更新はありません。
- LAN公開はHTTPです。信頼できるネットワークでのみ使用してください。
- Windows 10 22H2実機での検証は未実施です(Windows 11で検証)。

## ライセンス

Kurarium本体はMIT Licenseです。同梱コンポーネントは各ライセンスに従います。
詳細は `LEGAL-NOTICES.zip` を参照してください。
