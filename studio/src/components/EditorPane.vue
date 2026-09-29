<script setup lang="ts">
import type { EditorMode, ThemeName } from "@studio/types";
import { MdEditor, MdPreview } from "md-editor-v3";
import { computed } from "vue";

const props = defineProps<{
	modelValue: string;
	theme: ThemeName;
	mode: EditorMode;
	disabled: boolean;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: string];
	save: [];
	uploadImage: [files: File[], done: (urls: string[]) => void];
}>();

// 预览主题取自 md-editor-v3 内置的 github 主题族，跟博客的
// expressive-code 观感接近；纯预览模式才用 MdPreview，编辑模式统一走
// MdEditor 的 preview 开关。
const previewTheme = computed(() =>
	props.theme === "dark" ? "default" : "github",
);
const codeTheme = computed(() =>
	props.theme === "dark" ? "atom-one-dark" : "github",
);
</script>

<template>
	<MdPreview
		v-if="mode === 'preview'"
		:model-value="modelValue"
		:theme="theme"
		:preview-theme="previewTheme"
		:code-theme="codeTheme"
		:auto-fold-threshold="40"
		class="editor__surface"
	/>
	<MdEditor
		v-else
		:model-value="modelValue"
		:theme="theme"
		:preview-theme="previewTheme"
		:code-theme="codeTheme"
		:preview="mode === 'split'"
		:disabled="disabled"
		:tab-width="4"
		:auto-fold-threshold="40"
		:footers="['markdownTotal', '=', 'scrollSwitch']"
		class="editor__surface"
		@update:model-value="emit('update:modelValue', $event)"
		@on-save="emit('save')"
		@on-upload-img="(files, done) => emit('uploadImage', files, done)"
	/>
</template>

<style scoped>
.editor__surface {
	height: 100%;
}

:deep(.md-editor) {
	height: 100%;
}

:deep(.md-editor .md-editor-toolbar-wrapper),
:deep(.md-editor .md-editor-footer-wrapper) {
	border-color: var(--border);
	background: var(--bg-elev);
}

:deep(.md-editor .md-editor-toolbar),
:deep(.md-editor .md-editor-toolbar-item) {
	color: var(--text-dim);
}

/* 编辑区留出呼吸感，窄屏收窄边距 */
:deep(.md-editor .md-editor-input-wrapper),
:deep(.md-editor .md-editor-preview-wrapper) {
	padding: 1.5rem 0;
}

:deep(.md-editor .md-editor-input) {
	font-family: var(--font-ui);
	font-size: 1rem;
	line-height: 1.85;
}

:deep(.md-editor .md-editor-preview) {
	padding: 0 1.5rem;
}

/* 正文里的代码块沿用博客的 JetBrains Mono 与横向滚动 */
:deep(.md-editor .md-editor-preview pre),
:deep(.md-editor .md-editor-input pre) {
	font-family: var(--font-mono);
}

@media (width <= 48rem) {
	:deep(.md-editor .md-editor-input-wrapper) {
		padding: 0.75rem 0;
	}

	:deep(.md-editor .md-editor-preview) {
		padding: 0 0.75rem;
	}
}
</style>
