import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Vercel config.json のスキーマ
 */
const VercelConfigSchema = z.object({
	version: z.literal(3),
	routes: z.array(
		z.object({
			src: z.string(),
			dest: z.string().optional(),
			headers: z.record(z.string(), z.string()).optional(),
			methods: z.array(z.string()).optional(),
		}),
	),
});

/**
 * .vc-config.json のスキーマ
 */
const VcConfigSchema = z.object({
	runtime: z.string(),
	handler: z.string(),
	launcherType: z.string(),
	shouldAddHelpers: z.boolean(),
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, ".vercel/output");

/**
 * ビルドメイン処理
 */
const main = () => {
	// 出力ディレクトリをクリーンアップ
	if (existsSync(outputDir)) {
		rmSync(outputDir, { recursive: true });
	}

	// ディレクトリ構造を作成
	mkdirSync(join(outputDir, "static/assets"), { recursive: true });
	mkdirSync(join(outputDir, "functions/api.func"), { recursive: true });

	// 1. config.json を作成
	const config = VercelConfigSchema.parse({
		version: 3,
		routes: [
			// 静的アセット
			{
				src: "/assets/(.*)",
				headers: {
					"Cache-Control": "public, max-age=31536000, immutable",
					"X-Content-Type-Options": "nosniff",
				},
			},
			// API ルート
			{ src: "/api/(.*)", dest: "/api" },
			{ src: "/health", dest: "/api" },
			// その他すべてのリクエストを API（SSR）にルーティング
			{ src: "/(.*)", dest: "/api" },
		],
	});

	writeFileSync(join(outputDir, "config.json"), JSON.stringify(config, null, 2));

	// 2. 静的ファイルをコピー（dist/ → static/）
	const distDir = join(rootDir, "dist");
	if (existsSync(distDir)) {
		cpSync(distDir, join(outputDir, "static"), { recursive: true });
	}

	// public/ の既存ファイル（lumina.svg）もコピー
	const logoPath = join(rootDir, "public/lumina.svg");
	if (existsSync(logoPath)) {
		cpSync(logoPath, join(outputDir, "static/lumina.svg"));
	}

	// 3. Function をコピー
	const apiSource = existsSync(join(rootDir, "api/index.js"))
		? join(rootDir, "api/index.js")
		: join(rootDir, "api/index.cjs");

	if (!existsSync(apiSource)) {
		throw new Error(`API bundle not found at ${apiSource}. Please run 'pnpm build:api' first.`);
	}

	cpSync(apiSource, join(outputDir, "functions/api.func/index.js"));

	// 4. Function の設定ファイルを作成（Node.js Functions）
	const funcConfig = VcConfigSchema.parse({
		runtime: "nodejs20.x",
		handler: "index.js",
		launcherType: "Nodejs",
		shouldAddHelpers: true,
	});

	writeFileSync(
		join(outputDir, "functions/api.func/.vc-config.json"),
		JSON.stringify(funcConfig, null, 2),
	);

	// 5. Function の package.json を作成（CommonJS用）
	const funcPackageJson = {
		type: "commonjs",
	};

	writeFileSync(
		join(outputDir, "functions/api.func/package.json"),
		JSON.stringify(funcPackageJson, null, 2),
	);

	console.log("✅ Build Output created at .vercel/output/");
};

main();
