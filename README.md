# 指宿枕崎線 サイクルロゲイニング（MVP）

## 目的
- 仕様（要件定義/基本設計/詳細設計 v0.9相当）に基づく、まず遊べるPWA（React）を提供するMVP。
- CSV取込（方式B）→ スタート/ゴール/CP/時間/JR設定 → 地図でプレイ → チェックイン → リザルト

## 動かし方
1. 依存関係
```bash
npm install
```

2. Google Maps API Key
`.env` を作成（例：`.env.example`をコピー）
```bash
cp .env.example .env
# .env を開いて VITE_GOOGLE_MAPS_API_KEY を設定
```

3. 起動
```bash
npm run dev
```

## 実装済み（MVP）
- UI：React + React Router
- 状態：Zustand（ゲーム進行を保持、永続化はIndexedDBに保存）
- 永続化：IndexedDB（idb）
- 地図：Google Maps JS API（AdvancedMarker / MarkerClusterer）
- CSV取込（方式B）：スポット台帳CSV（必須）／駅マスタCSV（任意）
  - バリデーション（MVP）：必須列欠け（ID/Name/Latitude/Longitude/Score/JudgeTarget）／ID重複
  - JudgeTarget=0 は地図に表示しない
- チェックイン
  - 50m以内 & accuracy<=100m
  - 複数候補時（案A）：最近傍→同率ならScore高→同率ならID昇順
- JRチェックイン（JR=ON時のみ）
  - 乗車/降車、成功後60秒クールダウン（残秒表示/ボタン無効）
  - 同一駅での乗車・降車は禁止（ゲーム全体で乗降に同一駅を再利用不可）
  - 乗車→降車で、乗車/降車/通過駅のscoreを加算（駅マスタCSVにscore列がある場合）

## 未実装（次フェーズ候補）
- 実績解除・加点（ゲーム内リセット、解除のみ累計）
- 距離ロジックBの完全実装（CSV経路距離を使った駅間/スポット間グラフ構築の精密化）
- 管理者画面の配点CSVインポート、地図反映（運用機能）
- 規約/免責/プライバシーの文面・画面
