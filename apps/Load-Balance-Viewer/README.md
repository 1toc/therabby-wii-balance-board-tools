# Load Balance Viewer v1.0 β

Wii Balance Board の4点荷重、左右・前後荷重比、正規化CoPをリアルタイム表示するブラウザアプリです。

## Version

- App: **v1.0 β**
- Session Data Format: **v0.2**

## 主な機能

- LF / RF / LB / RB の4点荷重表示
- 総荷重
- 左右・前後荷重比
- 正規化CoP表示
- REAL WBB / MOCK
- ZERO / SET CENTER
- Session Data Format v0.2 で保存
- Wii Balance Board接続時の青LED制御

## 起動

`START_LOAD_BALANCE_VIEWER.bat` をダブルクリックしてください。

Pythonや.NET SDKは不要です。対応するChrome / Edgeで使用します。

## 保存データ

1セッションにつき以下を保存します。

- `summary.json`
- `samples.csv`
- `events.csv`

`summary.json` の `app.version` は **`1.0 β`** として保存されます。

## CoP

- X = (Right - Left) / Total
- Y = (Front - Back) / Total
- 正規化座標 -1〜+1
- mm単位のCoPではありません

## 注意

本ソフトウェアは医療機器・標準化された臨床評価機器ではありません。表示値は観察・評価・練習を補助する情報として使用してください。
