# Balance Controller v1.0 β

Wii Balance Boardの重心移動をWindowsのマウスポインタ操作へ変換するブラウザ＋ローカルブリッジアプリです。

## Version

- App: **v1.0 β**
- Session Data Format: **v0.2**

## 主な機能

- 左右・前後の重心移動 → マウス移動
- CENTERへ戻る → 停止
- 足トン → 左クリック
- トン・トン → ダブルクリック
- マウス速度・デッドゾーン・足トン感度調整
- REAL WBB / MOCK
- 操作ログをSession Data Format v0.2 で保存

## 起動

`START_BALANCE_CONTROLLER.bat` をダブルクリックしてください。

同梱PowerShellサーバーがWindows `user32.dll` 経由でマウスを操作します。Pythonや.NET SDKは不要です。

## 保存データ

- `summary.json`
- `samples.csv`
- `events.csv`

`summary.json` の `app.version` は **`1.0 β`** として保存されます。

## 注意

Balance Controllerはバランス能力の標準化評価ではなく、重心移動をデバイス操作へ活用するAPPLICATIONツールです。
