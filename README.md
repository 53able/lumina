# Lumina 🔍

## 論文の海で、求めていた研究に出会える

arXiv の論文を **セマンティック検索** で探し、**AI が要約** してくれるプラットフォーム。

「この論文、どこにあるんだ...」という悩みから解放されます。

---

## こんなあなたにぴったり

- 🎓 研究テーマに関連する論文を効率よく見つけたい
- ⏱️ 論文をザッと理解したいけど、時間がない
- 🔎 キーワード検索では見落とす「関連研究」を発見したい

---

## 何ができるのか？

### 1. セマンティック検索

テキスト説明で論文を検索。キーワードマッチングより、**意味で探す**

```
入力: "ディープラーニングで物体認識をする時、エッジデバイスで高速化するには？"
↓
OpenAI Embedding で意味を理解
↓
関連度の高い論文が見つかる
```

### 2. AI による自動要約

GPT-4.1-nano が論文をサッと要約。時間がない時の強い味方

### 3. カテゴリ別の探索

Computer Science, Physics, Biology... 興味の分野を絞って探索

### 4. 検索履歴の管理

過去の検索を保存して、いつでも参照可能

---

## セットアップ（3ステップ）

### Step 1: 環境変数を設定

`.env.example` をコピーして `.env` を作成し、OpenAI API Key を設定します。

```bash
cp .env.example .env
```

```.env
# Basic認証（API保護）
BASIC_AUTH_USERNAME=admin
BASIC_AUTH_PASSWORD=admin

# OpenAI API Key（https://platform.openai.com/api-keys で取得）
OPENAI_API_KEY=your_openai_api_key_here
```

### Step 2: 依存をインストール

```bash
pnpm install
```

### Step 3: 開発サーバー起動

**ターミナル1: フロントエンド（Vite HMR 有効）**

```bash
pnpm dev
```

**ターミナル2: バックエンド（Hono サーバー）**

```bash
pnpm api
```

ブラウザで `http://localhost:5173` を開く → 完成！🎉

---

## 技術スタック

### フロントエンド

| 技術 | 用途 |
|------|------|
| React 19 | UIフレームワーク |
| shadcn/ui | UI コンポーネント |
| Tailwind CSS v4 | スタイリング |
| Zustand | クライアント状態管理 |
| TanStack Query | サーバー状態管理 |
| Vite | ビルドツール |

### バックエンド

| 技術 | 用途 |
|------|------|
| Hono | Web フレームワーク |
| Vercel Functions | サーバーレス実行 |
| OpenAI API | Embedding & 要約生成 |
| Zod | スキーマ検証 |

### 開発

| 技術 | 用途 |
|------|------|
| TypeScript | 型安全性 |
| Biome | Lint + Format |
| Vitest | テスト実行 |

---

## 主な機能

- ✅ arXiv から最新論文を自動同期
- ✅ セマンティック検索（意味で探す）
- ✅ AI 要約生成
- ✅ カテゴリフィルタ
- ✅ 検索履歴管理
- ✅ モバイル対応（Responsive Design）

---

## API エンドポイント

### 開発環境

| エンドポイント | 説明 |
|---|---|
| `http://localhost:5173` | フロントエンド |
| `http://localhost:3000/api/ui` | Swagger UI |
| `http://localhost:3000/api/doc` | OpenAPI JSON |

### 本番環境（Vercel）

```
https://<your-domain>/
https://<your-domain>/api/v1/*
```

---

## コマンド集

```bash
# セットアップ
pnpm install

# 開発
pnpm dev          # フロント
pnpm api          # バック

# 品質チェック
pnpm typecheck    # 型チェック
pnpm lint         # Lint
pnpm test         # テスト

# ビルド
pnpm build        # 本番ビルド
```

---

## デプロイ（Vercel）

このプロジェクトは Vercel にネイティブ対応しています。

```bash
# Vercel CLI をインストール
npm i -g vercel

# デプロイ
vercel deploy
```

環境変数は Vercel Dashboard > Settings > Environment Variables で設定してください。

---

## 開発ガイド

### 型安全性を重視

- Zod スキーマファースト → TypeScript 型は自動生成
- `any` 型は **禁止**
- バリデーション必須（スキーマで検証）

### コード品質

すべてのコミット前に実行：

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

---

## トラブルシューティング

### OpenAI API Key が見つからない

- `.env` ファイルが作成されているか確認
- API Key は https://platform.openai.com/api-keys で取得可能

### Basic 認証エラー

- デフォルト: `username=admin`, `password=admin`
- 本番環境では必ず変更してください

### Vite Port 競合

```bash
pnpm dev -- --port 5174
```

---

## あなたのコントリビューションを待ってます 🎉

- 🐛 バグ報告：Issues で報告
- 💡 機能提案：Discussions で相談
- 🔧 Pull Request：歓迎！

---

## ライセンス

MIT

---

**Happy Researching! 📚**
