# Weight Shift Trainer v1.0 β

Wii Balance Boardを使い、能力範囲内で狙った位置へ重心を移動し、保持し、中央へ戻る練習を行うブラウザアプリです。

## Version

- App: **v1.0 β**
- Session Data Format: **v0.2**

## 主な機能

- 右 / 左 / 前 / 後
- 左右交互 / 前後交互
- 目標距離設定
- 保持時間設定
- 反復回数・実施時間設定
- 正規化CoPによる目標フィードバック
- First Target Acquisition
- Target Re-entry / Hold Interruption
- REAL WBB / MOCK
- Session Data Format v0.2 で保存

## 起動

`START_WEIGHT_SHIFT_TRAINER.bat` をダブルクリックしてください。

## 保存データ

- `summary.json`
- `samples.csv`
- `events.csv`

`summary.json` の `app.version` は **`1.0 β`** として保存されます。

## 注意

本アプリの値は正規化CoPによる練習成績です。標準化された臨床評価スコアではありません。
