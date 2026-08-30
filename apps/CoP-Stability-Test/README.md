# CoP Stability Test v1.0 β

Wii Balance Boardを使い、一定時間の静止立位における正規化CoP軌跡と揺れ指標を記録するブラウザアプリです。

## Version

- App: **v1.0 β**
- Session Data Format: **v0.2**

## 主な機能

- 10 / 30 / 60秒の静止立位計測
- 正規化CoP軌跡
- Normalized Path Length
- Mean Velocity
- ML Range
- AP Range
- RMS Sway
- Mean Load
- REAL WBB / MOCK
- Session Data Format v0.2 で保存

## 起動

`START_COP_STABILITY_TEST.bat` をダブルクリックしてください。

## 基本手順

1. REAL WBBに切り替える
2. Wii Balance Boardを接続
3. 必要に応じてZERO
4. ボード上に立つ
5. 測定時間を選ぶ
6. START TEST
7. 結果を確認して保存

## 保存データ

- `summary.json`
- `samples.csv`
- `events.csv`

`summary.json` の `app.version` は **`1.0 β`** として保存されます。

## 注意

現在のCoPと各指標は正規化座標に基づきます。mm、mm/s、cm²などの物理単位ではなく、標準化された臨床評価スコアでもありません。
