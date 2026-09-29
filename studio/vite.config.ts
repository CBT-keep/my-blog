import path from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const studioRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(studioRoot, "..");

export default defineConfig({
	root: studioRoot,
	// 后台可能挂在反向代理的子路径下，用相对引用省去部署时的 base 配置
	base: "./",
	plugins: [vue()],
	resolve: {
		alias: {
			"@": path.join(repoRoot, "src"),
			"@studio": path.join(studioRoot, "src"),
		},
	},
	server: {
		// 前后端类型契约放在 src/types/studio.ts，需要放行仓库根目录
		fs: { allow: [repoRoot] },
	},
	build: {
		outDir: path.join(studioRoot, "dist"),
		emptyOutDir: true,
		// mermaid 的 elk 布局引擎单个 chunk 就有 1.4MB，且只在正文里真的出现
		// mermaid 图时才被动态加载；阈值调到它之上，避免每次构建都刷无关告警
		chunkSizeWarningLimit: 1600,
	},
});
