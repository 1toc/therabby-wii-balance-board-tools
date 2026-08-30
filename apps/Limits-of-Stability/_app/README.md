# Limits of Stability v1.0 β

足を動かさず、安全に各方向へどこまで重心を移動できるかを正規化CoPで可視化するブラウザアプリです。

## Version

- App: **v1.0 β**
- Session Data Format: **v0.2**

## 主な機能

- 4方向 / 8方向
- ZERO / CENTER
- 各方向の最大到達量
- CENTERへの復帰・静止フロー
- 方向別最大到達のポリゴン表示
- 左右差・前後差
- REAL WBB / MOCK
- Session Data Format v0.2 で保存

## 起動

`START_LIMITS_OF_STABILITY.bat` をダブルクリックしてください。

REAL WBBではSTART TEST後にZEROとCENTERを設定して測定します。

## 保存データ

- `summary.json`
- `samples.csv`
- `events.csv`

`summary.json` の `app.version` は **`1.0 β`** として保存されます。

## 注意

結果はCENTER相対の正規化CoPです。物理的なmm / cmではなく、標準化された臨床評価スコアでもありません。
