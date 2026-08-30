# Session Data Format v0.2

5つのWii Balance Boardブラウザアプリで共通利用するセッション保存形式です。
Session Log & Reportが各アプリの結果を自動判別・可視化・比較できることを目的とします。

## 1セッションの3ファイル

- `*-summary.json` — アプリ、条件、プロトコル、主要結果
- `*-samples.csv` — 時系列センサーデータ
- `*-events.csv` — セッション中の意味のあるイベント

3ファイルは同じ `session_id` / ファイル名プレフィックスを共有します。

## v0.2の主な変更

1. `session.duration_sec` を廃止し、`elapsed_sec` と `measurement_sec` に分離。
   - `elapsed_sec`: セッション開始から実際の終了までの経過時間。
   - `measurement_sec`: 実際に測定・訓練・操作を記録した時間。
   - 保存ボタンを押すまで待った時間は測定時間に含めません。
2. Weight Shift Trainerを「予定・開始・完了・成功」に分け、最初の目標到達と再進入を区別。
3. Limits of StabilityのCENTER到達イベントを方向ごとに1回へ整理し、最大到達量の名称を `from_center` と明示。
4. Balance Controllerの時系列データに `mouse_dx_px` / `mouse_dy_px` を追加し、実際に送った相対マウス移動を保存。

## summary.json 共通構造

```json
{
  "schema_version": "0.2",
  "session_id": "20260830-103015-cop-stability-test",
  "app": {
    "name": "CoP Stability Test",
    "slug": "cop-stability-test",
    "version": "1.0 β"
  },
  "session": {
    "datetime": "2026-08-30T10:30:15.000+09:00",
    "ended_at": "2026-08-30T10:30:45.000+09:00",
    "elapsed_sec": 30.0,
    "measurement_sec": 30.0,
    "mode": "REAL_WBB",
    "sample_count": 2800
  },
  "condition": {},
  "protocol": {},
  "metrics": {},
  "notes": []
}
```

## samples.csv 共通先頭列

```text
time_ms
lf_kg
rf_kg
lb_kg
rb_kg
total_kg
cop_x_norm
cop_y_norm
weight_present
```

各アプリ固有列はこの後ろに追加します。

## events.csv 共通列

```text
time_ms,event,phase,trial,direction,value,note
```

## アプリ固有のv0.2指標

### Load Balance Viewer

主なsummary指標: 平均荷重、左右/前後荷重比、平均CoP。
`measurement_sec` はLOG START〜LOG STOPの記録時間です。

### CoP Stability Test

主なsummary指標: Path Length、Mean Velocity、ML/AP Range、RMS Sway、平均荷重、平均CoP。
`measurement_sec` は実際の測定時間です。結果画面を見てから保存するまでの待機時間は含みません。

### Weight Shift Trainer

主なsummary指標:

- `planned_trials`
- `started_trials`
- `completed_trials`
- `successful_trials`
- `completion_rate_pct`
- `success_rate_started_pct`
- `mean_first_target_acquisition_sec`
- `target_reentry_count`
- `hold_interruption_count`
- `mean_hold_time_sec`
- `mean_target_error_norm`
- `total_cop_path_norm`

イベントは初回到達を `TARGET_REACHED`、一度外れて再度入った場合を `TARGET_REENTRY` と区別します。

### Limits of Stability

方向別主要指標は `max_excursion_from_center_norm`。
CENTERからの相対移動量なので1.0を超える場合があります。絶対CoP座標の-1〜+1とは意味が異なります。

RETURN中の `CENTER_REACHED` は方向ごとに最初の1回だけ記録し、1秒保持完了を `CENTER_HOLD_COMPLETE` として記録します。

### Balance Controller

評価指標ではなくAPPLICATION / device-operation performanceとして扱います。

samples固有列:

- `output_x_norm`
- `output_y_norm`
- `direction`
- `mouse_enabled`
- `mouse_dx_px`
- `mouse_dy_px`
- `tap_impulse_pct`

summaryには `mouse_distance_px`、`mouse_move_event_count`、クリック数、ダブルクリック数を保存します。
`measurement_sec` はMOUSE CONTROLがONだった累積時間です。

## condition

v0.2でも患者氏名・生年月日・カルテ番号などの直接識別情報は保存しません。
現状UIで入力していない条件は `not_recorded` とします。

## 解釈上の注意

正規化CoPは物理距離(mm/cm)ではありません。標準化された臨床評価スコアとして扱わず、同一患者・同一条件での比較、動作観察との照合、臨床仮説形成に利用する設計です。
