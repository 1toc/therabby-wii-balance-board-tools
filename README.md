# Therabby Wii Balance Board Tools v1.0 β

Wii Balance Boardを、荷重・バランス・身体操作を扱う臨床向けツール群として再構成したβ版パッケージです。

## Version

**Therabby Wii Balance Board Tools v1.0 β**

データ出力を行う5アプリは **Session Data Format v0.2** を使用します。

## Apps

| App | Role | Version |
|---|---|---|
| [Load Balance Viewer](apps/Load-Balance-Viewer/) | OBSERVE / 荷重配分とCoPの観察 | v1.0 β |
| [CoP Stability Test](apps/CoP-Stability-Test/) | STABILITY / 静止立位の揺れ | v1.0 β |
| [Limits of Stability](apps/Limits-of-Stability/) | CAPACITY / 最大重心移動範囲 | v1.0 β |
| [Weight Shift Trainer](apps/Weight-Shift-Trainer/) | CONTROL / 重心移動の練習 | v1.0 β |
| [Balance Controller](apps/Balance-Controller/) | APPLICATION / 重心移動によるデバイス操作 | v1.0 β |
| [Session Log & Report](apps/Session-Log-Report/) | INTERPRET / 可視化・比較・記録 | v1.0 β |

## Session Data

5つの入力・評価・練習アプリは、1セッションにつき原則として以下を保存します。

- `summary.json`
- `samples.csv`
- `events.csv`

`summary.json` の `app.version` は `1.0 β`、`schema_version` は `0.2` です。

共通仕様: [Session Data Format v0.2](docs/Session-Data-Format-v0.2.md)

## Status

現在は **v1.0 β** です。臨床試用・実機利用を通じてUI、測定フロー、指標、保存仕様を検証する段階です。

## Important

本ツール群は医療機器ではなく、標準化された臨床評価スコアを提供するものでもありません。正規化CoP等の値は、同一条件での比較、動作観察、臨床家の判断と組み合わせて使用してください。
