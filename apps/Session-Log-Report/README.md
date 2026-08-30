# Session Log & Report v1.0 β

5つのWii Balance Boardアプリが出力する **Session Data Format v0.2** を読み込み、1セッションの結果表示から同一アプリの経時比較まで行うレポートツールです。

## Version

- App: **v1.0 β**
- Supported Session Data Format: **v0.2**

## 主な機能

- `summary.json` 単独での読み込み
- `summary.json + samples.csv + events.csv` の3ファイル読み込み
- アプリ別グラフ表示
- 同一アプリの複数セッション比較
- セッション概要・指標・イベントの可視化
- 記述的な自動コメント
- 生活場面で確認したい候補の提示

## 対応アプリ

- Load Balance Viewer
- CoP Stability Test
- Limits of Stability
- Weight Shift Trainer
- Balance Controller

## 起動

`START_SESSION_LOG_REPORT.bat` をダブルクリックしてください。

## データについて

Session Log & Report自体はWii Balance Boardへ接続しません。各アプリから保存したSession Data Format v0.2のファイルを読み込んで使用します。

## 注意

自動コメントは診断や転倒リスク判定ではなく、データ上の特徴を記述するための補助です。実際の生活動作や臨床所見と合わせて解釈してください。
