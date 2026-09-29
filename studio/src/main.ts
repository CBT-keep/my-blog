import { config } from "md-editor-v3";
import { createApp } from "vue";
import "md-editor-v3/lib/style.css";
import "md-editor-v3/lib/preview.css";
import hljs from "highlight.js/lib/common";
import "@fontsource-variable/jetbrains-mono";
import katex from "katex";
import "katex/dist/katex.min.css";
import App from "@studio/App.vue";
import "@studio/styles/app.css";

/**
 * md-editor-v3 默认从 unpkg 拉取 katex / highlight.js / mermaid 等扩展脚本，
 * 本机离线或网络受限时这些能力会静默失效。
 *
 * 这里全部传本地实例：编辑器检测到 instance 后就不再注入外部 <script> 与
 * <link>，代价是配套样式要自己提供——
 *   - katex 的 CSS 从它自己的包引入；
 *   - highlight.js 的主题样式见 styles/app.css 里的 .hljs-* 规则；
 *   - mermaid 的主题由编辑器自己 initialize，无需额外样式。
 *
 * mermaid 体积很大（构建后是独立 chunk）；而编辑器在组件创建时一次性读取
 * instance，晚于挂载再注入就不会生效，所以等它加载完再挂载应用。
 */
const { default: mermaid } = await import("mermaid");

config({
	editorExtensions: {
		katex: { instance: katex },
		highlight: { instance: hljs },
		mermaid: { instance: mermaid },
	},
});

const stored = localStorage.getItem("studio-theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
document.documentElement.dataset.theme =
	stored === "light" || stored === "dark"
		? stored
		: prefersLight
			? "light"
			: "dark";

createApp(App).mount("#app");
