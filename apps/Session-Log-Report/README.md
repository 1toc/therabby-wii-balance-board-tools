# Session Log & Report v1.0 β

Wii Balance Board Toolsが出力したSession Data Format v0.2を読み込み、1セッションの可視化から複数セッション比較まで行うブラウザアプリです。

## Version

- App: **v1.0 β**
- Supported Session Data Format: **v0.2**

## 読み込めるファイル

- `*-summary.json`
- `*-samples.csv`
- `*-events.csv`

`summary.json`だけでも主要結果を表示できます。`samples.csv`を追加するとCoP軌跡・時系列グラフ、`events.csv`を追加するとイベントログまで表示します。

## 主な機能

- 1セッションレポート
- アプリ別グラフ
- 今回の特徴の記述
- 生活場面で確認する候補
- 同一アプリの複数セッション比較
- 印刷
- ファイルはブラウザ内で処理

## 起動

黒いコマンド画面を出さずに起動する場合：

`START_SESSION_LOG_REPORT.vbs`

または：

`START_SESSION_LOG_REPORT.bat`

## 対応アプリ

- Load Balance Viewer
- CoP Stability Test
- Weight Shift Trainer
- Limits of Stability
- Balance Controller

## 注意

表示される正規化CoPや各アプリ固有指標は標準化された臨床評価スコアではありません。同一条件での経時比較、実際の動作観察、臨床家の判断と組み合わせて使用してください。
