<script setup lang="ts">
import {
	ExternalLink,
	Focus,
	LogOut,
	Moon,
	PanelLeft,
	PanelRight,
	Pencil,
	Rocket,
	Save,
	Sun,
	Trash2,
} from "@lucide/vue";
import {
	createPost,
	deletePost,
	getPost,
	getSession,
	listPosts,
	login as loginRequest,
	logout as logoutRequest,
	publishPosts,
	renamePost,
	StudioError,
	savePost,
	uploadImage,
} from "@studio/api";
import EditorPane from "@studio/components/EditorPane.vue";
import MetaPanel from "@studio/components/MetaPanel.vue";
import PostList from "@studio/components/PostList.vue";
import type { EditorMode, SaveState, ThemeName } from "@studio/types";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
	PostDocument,
	PostFrontmatter,
	PostSummary,
} from "@/types/studio";
import { countWords } from "@/utils/word-count";

type DialogKind = "create" | "rename" | "delete" | "publish" | null;

const AUTOSAVE_DELAY = 1200;
const NARROW_QUERY = "(width <= 60rem)";

const theme = ref<ThemeName>(
	document.documentElement.dataset.theme === "light" ? "light" : "dark",
);
const mode = ref<EditorMode>("edit");
const focusMode = ref(false);
const isNarrow = ref(window.matchMedia(NARROW_QUERY).matches);
const sidebarOpen = ref(false);
const metaOpen = ref(false);

const ready = ref(false);
const authenticated = ref(false);
const tokenInput = ref("");
const authError = ref("");
const previewOrigin = ref("");

const posts = ref<PostSummary[]>([]);
const search = ref("");
const activeSlug = ref<string | null>(null);
const body = ref("");
const meta = ref<PostFrontmatter>(emptyMeta());
const revision = ref("");

const saveState = ref<SaveState>("idle");
const saveError = ref("");
const hasConflict = ref(false);
const loadingPost = ref(false);
const publishState = ref<"idle" | "publishing" | "done" | "error">("idle");
const publishMessage = ref("");
const publishError = ref("");

const dialog = ref<DialogKind>(null);
const dialogSlug = ref("");
const dialogTitle = ref("");
const dialogError = ref("");
const submitting = ref(false);

let saveTimer: number | undefined;
/** 每次内容变化自增，用来判断保存请求进行中是否又发生了新的编辑。 */
let editSeq = 0;
/**
 * 最近一次落盘内容的快照。
 *
 * 用它判断「现在的内容是否真的和磁盘不同」，而不是在载入时挂一个抑制标志：
 * 载入文章同样会改写 body 与 meta，深度侦听会把它误判成一次编辑，
 * 于是打开一篇文章就白写一次盘，还会把手工排好的 frontmatter 重排。
 */
let savedSnapshot = "";
/** 飞行中的保存请求；并发调用复用同一个 promise，避免两次写同一篇文章。 */
let saveInFlight: Promise<void> | null = null;
/** 打开文章的请求序号，用于丢弃迟到的响应。 */
let openSeq = 0;
let narrowQuery: MediaQueryList | undefined;

function emptyMeta(): PostFrontmatter {
	return {
		title: "",
		published: new Date().toISOString().slice(0, 10),
		updated: "",
		draft: true,
		description: "",
		image: "",
		tags: [],
		category: "",
		lang: "",
		pinned: false,
		author: "",
		sourceLink: "",
		licenseName: "",
		licenseUrl: "",
		comment: true,
		password: "",
		passwordHint: "",
		wikiExclude: false,
	};
}

const categories = computed(() => {
	const seen = new Set<string>();
	for (const post of posts.value) {
		if (post.category) seen.add(post.category);
	}
	return [...seen].sort();
});

/** 与服务端列表页共用同一份实现，避免两处字数口径不一致。 */
const words = computed(() => countWords(body.value));

const statusText = computed(() => {
	switch (saveState.value) {
		case "saving":
			return "保存中…";
		case "saved":
			return "已保存";
		case "dirty":
			return "未保存";
		case "error":
			return "保存失败";
		default:
			return "";
	}
});

const previewUrl = computed(() =>
	previewOrigin.value && activeSlug.value
		? `${previewOrigin.value}/posts/${activeSlug.value}/`
		: "",
);

async function publishToGithub(): Promise<void> {
	if (publishState.value === "publishing") return;
	if (saveState.value === "dirty" || saveState.value === "error") {
		await save();
		if (saveState.value === "error") return;
	}

	publishState.value = "publishing";
	publishMessage.value = "";
	publishError.value = "";
	try {
		const result = await publishPosts();
		publishMessage.value = result.detail;
		publishState.value = "done";
	} catch (error) {
		publishError.value = describeError(error);
		publishState.value = "error";
	}
}

function openPublishDialog(): void {
	if (publishState.value === "publishing") return;
	dialogError.value = "";
	dialog.value = "publish";
}

/* ---------------- 会话 ---------------- */

async function boot(): Promise<void> {
	try {
		const session = await getSession();
		previewOrigin.value = session.previewOrigin;
		if (session.authenticated) {
			authenticated.value = true;
			await refreshPosts();
		}
	} catch (error) {
		authError.value = describeError(error);
	} finally {
		ready.value = true;
	}
}

async function submitLogin(): Promise<void> {
	authError.value = "";
	try {
		await loginRequest(tokenInput.value);
		tokenInput.value = "";
		authenticated.value = true;
		await refreshPosts();
	} catch (error) {
		authError.value = describeError(error);
	}
}

async function signOut(): Promise<void> {
	await logoutRequest();
	location.reload();
}

/* ---------------- 文章读写 ---------------- */

async function refreshPosts(): Promise<void> {
	posts.value = await listPosts();
}

/** 刷新列表失败不该产生未处理的 rejection；列表下轮保存后会再刷。 */
function refreshPostsInBackground(): void {
	void refreshPosts().catch((error: unknown) => {
		saveError.value = describeError(error);
	});
}

async function openPost(slug: string): Promise<void> {
	if (slug === activeSlug.value) return;
	// 切换文章前先把当前改动落盘，避免两篇的编辑内容互相覆盖。
	// 保存进行中时也要等它结束：否则飞行中的响应会把 revision 写到新文章上。
	if (saveInFlight) await saveInFlight;
	if (saveState.value === "dirty" || saveState.value === "error") {
		await save();
		if (saveState.value === "error") return;
	}
	// 连点两篇文章时，先发出的请求可能后返回，用序号丢弃过期结果
	openSeq += 1;
	const seq = openSeq;
	loadingPost.value = true;
	try {
		const loaded = await getPost(slug);
		if (seq !== openSeq) return;
		applyDocument(loaded);
		activeSlug.value = slug;
		hasConflict.value = false;
		saveError.value = "";
		saveState.value = "idle";
		if (isNarrow.value) sidebarOpen.value = false;
	} catch (error) {
		if (seq === openSeq) saveError.value = describeError(error);
	} finally {
		if (seq === openSeq) loadingPost.value = false;
	}
}

function applyDocument(loaded: PostDocument): void {
	body.value = loaded.body;
	meta.value = { ...loaded.frontmatter };
	revision.value = loaded.revision;
	savedSnapshot = snapshot();
	// 载入本身不算一次编辑
	editSeq += 1;
}

/** 当前编辑内容的指纹，用来和最近一次落盘的版本比较。 */
function snapshot(): string {
	return JSON.stringify({ frontmatter: meta.value, body: body.value });
}

function markDirty(): void {
	// 内容又回到与磁盘一致的状态时，撤回待保存并复位状态
	if (snapshot() === savedSnapshot) {
		window.clearTimeout(saveTimer);
		if (saveState.value === "dirty") saveState.value = "idle";
		return;
	}
	editSeq += 1;
	if (saveState.value !== "saving") saveState.value = "dirty";
	window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => void save(), AUTOSAVE_DELAY);
}

function save(): Promise<void> {
	window.clearTimeout(saveTimer);
	// 已有保存在飞就复用它：并发写同一篇文章只会互相覆盖
	if (saveInFlight) return saveInFlight;
	saveInFlight = performSave().finally(() => {
		saveInFlight = null;
	});
	return saveInFlight;
}

async function performSave(): Promise<void> {
	if (!activeSlug.value) return;
	const slug = activeSlug.value;
	const seqAtStart = editSeq;
	// 记下这次实际发出去的内容，成功后以它为新基线，
	// 请求期间的额外输入不会被误判成「已保存」
	const sentSnapshot = snapshot();
	saveState.value = "saving";
	saveError.value = "";
	try {
		const updated = await savePost(slug, {
			frontmatter: meta.value,
			body: body.value,
			revision: revision.value,
		});
		// 只取回新的 revision，正文与 frontmatter 保留请求期间的输入。
		// 保存期间文章若已被切走/删除，就不要再改新文章的基线。
		if (activeSlug.value === slug) {
			revision.value = updated.revision;
			savedSnapshot = sentSnapshot;
		}
		hasConflict.value = false;
		if (editSeq === seqAtStart) {
			saveState.value = "saved";
		} else {
			saveState.value = "dirty";
			saveTimer = window.setTimeout(() => void save(), AUTOSAVE_DELAY);
		}
		refreshPostsInBackground();
	} catch (error) {
		if (error instanceof StudioError && error.status === 409) {
			hasConflict.value = true;
		}
		saveState.value = "error";
		saveError.value = describeError(error);
	}
}

async function reloadFromDisk(): Promise<void> {
	if (!activeSlug.value) return;
	window.clearTimeout(saveTimer);
	try {
		applyDocument(await getPost(activeSlug.value));
		hasConflict.value = false;
		saveError.value = "";
		saveState.value = "idle";
	} catch (error) {
		saveError.value = describeError(error);
	}
}

/**
 * 冲突时保留屏幕上的内容强行覆盖：先取磁盘当前版本当基线，
 * 再用本地内容重存一次，绕过 revision 校验。
 */
async function forceOverwrite(): Promise<void> {
	if (!activeSlug.value) return;
	try {
		revision.value = (await getPost(activeSlug.value)).revision;
		hasConflict.value = false;
		await save();
	} catch (error) {
		saveError.value = describeError(error);
	}
}

/* ---------------- 新建 / 重命名 / 删除 ---------------- */

function openCreate(): void {
	dialogSlug.value = suggestSlug(meta.value.title);
	dialogTitle.value = "";
	dialogError.value = "";
	dialog.value = "create";
}

function openRename(): void {
	if (!activeSlug.value) return;
	dialogSlug.value = activeSlug.value;
	dialogTitle.value = meta.value.title;
	dialogError.value = "";
	dialog.value = "rename";
}

function openDelete(): void {
	if (!activeSlug.value) return;
	dialogError.value = "";
	dialog.value = "delete";
}

/** 中文标题没法直接做 slug，先给个占位让用户在其基础上改。 */
function suggestSlug(title: string): string {
	const ascii = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return ascii || `post-${new Date().toISOString().slice(0, 10)}`;
}

async function submitDialog(): Promise<void> {
	if (!dialog.value) return;
	submitting.value = true;
	dialogError.value = "";
	try {
		if (dialog.value === "publish") {
			dialog.value = null;
			void publishToGithub();
			return;
		}
		if (dialog.value === "create") {
			const created = await createPost({
				slug: dialogSlug.value.trim(),
				title: dialogTitle.value.trim() || undefined,
			});
			await refreshPosts();
			dialog.value = null;
			await openPost(created.slug);
			return;
		}
		if (dialog.value === "rename" && activeSlug.value) {
			const renamed = await renamePost({
				from: activeSlug.value,
				to: dialogSlug.value.trim(),
			});
			await refreshPosts();
			// 文件已经换名，先断开当前文章状态再载入新路径，
			// 否则待保存的定时器会往旧路径写
			resetEditor();
			await openPost(renamed.slug);
			return;
		}
		if (dialog.value === "delete" && activeSlug.value) {
			await deletePost(activeSlug.value);
			await refreshPosts();
			dialog.value = null;
			resetEditor();
		}
	} catch (error) {
		dialogError.value = describeError(error);
	} finally {
		submitting.value = false;
	}
}

function resetEditor(): void {
	window.clearTimeout(saveTimer);
	activeSlug.value = null;
	body.value = "";
	meta.value = emptyMeta();
	revision.value = "";
	savedSnapshot = snapshot();
	saveState.value = "idle";
	saveError.value = "";
	hasConflict.value = false;
}

/* ---------------- 图片 ---------------- */

async function onEditorUpload(
	files: File[],
	done: (urls: string[]) => void,
): Promise<void> {
	if (!activeSlug.value) return;
	const urls: string[] = [];
	for (const file of files) {
		try {
			urls.push((await uploadImage(activeSlug.value, file)).url);
		} catch (error) {
			saveError.value = describeError(error);
		}
	}
	done(urls);
}

async function onCoverUpload(file: File): Promise<void> {
	if (!activeSlug.value) return;
	try {
		meta.value = {
			...meta.value,
			image: (await uploadImage(activeSlug.value, file)).url,
		};
	} catch (error) {
		saveError.value = describeError(error);
	}
}

/* ---------------- 视图、主题、快捷键 ---------------- */

function toggleTheme(): void {
	theme.value = theme.value === "dark" ? "light" : "dark";
}

function openPreview(): void {
	if (previewUrl.value) window.open(previewUrl.value, "_blank", "noopener");
}

function closePanels(): void {
	sidebarOpen.value = false;
	metaOpen.value = false;
}

watch(theme, (value) => {
	document.documentElement.dataset.theme = value;
	localStorage.setItem("studio-theme", value);
});

watch([body, meta], markDirty, { deep: true });

function onGlobalKeydown(event: KeyboardEvent): void {
	if (!(event.metaKey || event.ctrlKey)) return;
	const key = event.key.toLowerCase();
	if (key === "s") {
		event.preventDefault();
		void save();
		return;
	}
	if (key === "e" && !event.shiftKey) {
		event.preventDefault();
		mode.value = mode.value === "edit" ? "split" : "edit";
		return;
	}
	if (key === "f") {
		event.preventDefault();
		focusMode.value = !focusMode.value;
	}
}

function onNarrowChange(event: MediaQueryListEvent): void {
	isNarrow.value = event.matches;
	if (!event.matches) closePanels();
}

function describeError(error: unknown): string {
	if (error instanceof StudioError) return error.message;
	if (error instanceof Error) return error.message;
	return "发生未知错误";
}

onMounted(() => {
	narrowQuery = window.matchMedia(NARROW_QUERY);
	narrowQuery.addEventListener("change", onNarrowChange);
	window.addEventListener("keydown", onGlobalKeydown);
	void boot();
});

onBeforeUnmount(() => {
	window.clearTimeout(saveTimer);
	narrowQuery?.removeEventListener("change", onNarrowChange);
	window.removeEventListener("keydown", onGlobalKeydown);
});
</script>

<template>
	<div v-if="!ready" class="boot muted">载入中…</div>

	<div v-else-if="!authenticated" class="login">
		<form class="login__form" @submit.prevent="submitLogin">
			<h1 class="dialog__title">写作台</h1>
			<p class="dialog__hint">输入启动日志里打印的口令以继续。</p>
			<input
				v-model="tokenInput"
				class="input"
				type="password"
				autocomplete="current-password"
				placeholder="口令"
			/>
			<p v-if="authError" class="dialog__error">{{ authError }}</p>
			<button class="button button--primary" type="submit">进入</button>
		</form>
	</div>

	<div v-else class="shell" :class="{ 'shell--focus': focusMode }">
		<header class="topbar">
			<span class="topbar__brand">
				<span class="topbar__dot" />
				写作台
			</span>

			<button
				class="button button--ghost button--icon"
				type="button"
				title="文章列表"
				:aria-pressed="sidebarOpen"
				@click="sidebarOpen = !sidebarOpen"
			>
				<PanelLeft :size="15" />
			</button>

			<input
				v-model="meta.title"
				class="topbar__title"
				type="text"
				placeholder="未命名文章"
				:disabled="!activeSlug"
				aria-label="文章标题"
			/>
			<span v-if="activeSlug" class="topbar__slug">{{ activeSlug }}</span>

			<div class="segmented" role="group" aria-label="视图模式">
				<button
					type="button"
					:aria-pressed="mode === 'edit'"
					@click="mode = 'edit'"
				>
					编辑
				</button>
				<button
					type="button"
					:aria-pressed="mode === 'split'"
					@click="mode = 'split'"
				>
					分屏
				</button>
				<button
					type="button"
					:aria-pressed="mode === 'preview'"
					@click="mode = 'preview'"
				>
					预览
				</button>
			</div>

			<span class="status" :class="{ 'status--error': saveState === 'error' }">
				{{ statusText }}<template v-if="activeSlug">· {{ words }} 字</template>
			</span>

			<div class="topbar__actions">
				<button
					class="button button--icon"
					type="button"
					title="在博客中查看"
					:disabled="!previewUrl"
					@click="openPreview"
				>
					<ExternalLink :size="15" />
				</button>
				<button
					class="button button--icon"
					type="button"
					title="重命名"
					:disabled="!activeSlug"
					@click="openRename"
				>
					<Pencil :size="15" />
				</button>
				<button
					class="button button--icon"
					type="button"
					title="删除文章"
					:disabled="!activeSlug"
					@click="openDelete"
				>
					<Trash2 :size="15" />
				</button>
				<button
					class="button button--icon"
					type="button"
					:title="focusMode ? '退出专注' : '专注写作'"
					:aria-pressed="focusMode"
					@click="focusMode = !focusMode"
				>
					<Focus :size="15" />
				</button>
				<button
					class="button button--icon"
					type="button"
					:title="theme === 'dark' ? '切换到浅色' : '切换到深色'"
					@click="toggleTheme"
				>
					<Sun v-if="theme === 'dark'" :size="15" />
					<Moon v-else :size="15" />
				</button>
				<button
					class="button button--icon"
					type="button"
					title="文章信息"
					:aria-pressed="metaOpen"
					@click="metaOpen = !metaOpen"
				>
					<PanelRight :size="15" />
				</button>
				<button
					class="button button--icon"
					type="button"
					title="退出登录"
					@click="signOut"
				>
					<LogOut :size="15" />
				</button>
				<button
					class="button button--primary"
					type="button"
					:disabled="!activeSlug || saveState === 'saving'"
					@click="save"
				>
					<Save :size="15" />
					保存
				</button>
				<button
					class="button button--primary"
					type="button"
					title="发布上线"
					:disabled="publishState === 'publishing'"
					@click="openPublishDialog"
				>
					<Rocket :size="15" />
					{{ publishState === "publishing" ? "发布中" : "发布上线" }}
				</button>
				<span
					v-if="publishError"
					class="status status--error"
				>
					{{ publishError }}
				</span>
				<span
					v-else-if="publishMessage"
					class="status"
				>
					{{ publishMessage }}
				</span>
			</div>
		</header>

		<div class="body">
			<PostList
				v-show="!isNarrow || sidebarOpen"
				v-model:search="search"
				:posts="posts"
				:active-slug="activeSlug"
				@select="openPost"
				@create="openCreate"
			/>

			<main class="editor">
				<div v-if="hasConflict" class="editor__banner">
					<span>{{ saveError }}</span>
					<button class="button" type="button" @click="reloadFromDisk">
						放弃改动并重载
					</button>
					<button class="button" type="button" @click="forceOverwrite">
						以本页内容覆盖
					</button>
				</div>
				<div
					v-else-if="saveState === 'error'"
					class="editor__banner"
				>
					<span>{{ saveError }}</span>
					<button class="button" type="button" @click="save">重试</button>
				</div>

				<EditorPane
					v-if="activeSlug"
					v-model="body"
					:theme="theme"
					:mode="mode"
					:disabled="loadingPost"
					@save="save"
					@upload-image="onEditorUpload"
				/>
				<div v-else class="editor__empty">
					<p>从左侧选一篇文章，或新建一篇开始写。</p>
					<button
						class="button button--primary"
						type="button"
						@click="openCreate"
					>
						新建文章
					</button>
				</div>
			</main>

			<MetaPanel
				v-if="activeSlug"
				v-show="!isNarrow || metaOpen"
				v-model:meta="meta"
				:categories="categories"
				:disabled="loadingPost"
				@upload-cover="onCoverUpload"
			/>
		</div>

		<button
			v-if="isNarrow && (sidebarOpen || metaOpen)"
			class="scrim"
			type="button"
			aria-label="关闭面板"
			@click="closePanels"
		/>
	</div>

	<div v-if="dialog" class="overlay" @click.self="dialog = null">
		<form class="dialog" @submit.prevent="submitDialog">
			<h2 v-if="dialog === 'create'" class="dialog__title">新建文章</h2>
			<h2 v-else-if="dialog === 'rename'" class="dialog__title">重命名文章</h2>
			<h2 v-else-if="dialog === 'delete'" class="dialog__title">删除文章</h2>
			<h2 v-else class="dialog__title">发布上线</h2>

			<p v-if="dialog === 'delete'" class="dialog__hint">
				将删除 <span class="mono">{{ activeSlug }}</span>
				对应的 Markdown 文件，文章目录下的图片不受影响。此操作不可撤销。
			</p>
			<p v-else-if="dialog === 'publish'" class="dialog__hint">
				确认把当前文章改动提交到 GitHub 吗？服务器会自动拉取构建结果。
			</p>

			<template v-else>
				<div class="field">
					<label class="field__label" for="dialog-slug">
						路径（slug，将作为文章 URL）
					</label>
					<input
						id="dialog-slug"
						v-model="dialogSlug"
						class="input input--mono"
						type="text"
						placeholder="my-first-post"
						required
					/>
				</div>
				<div v-if="dialog === 'create'" class="field">
					<label class="field__label" for="dialog-title">标题（可稍后写）</label>
					<input
						id="dialog-title"
						v-model="dialogTitle"
						class="input"
						type="text"
						placeholder="未命名文章"
					/>
				</div>
			</template>

			<p v-if="dialogError" class="dialog__error">{{ dialogError }}</p>

			<div class="dialog__actions">
				<button class="button" type="button" @click="dialog = null">
					取消
				</button>
				<button
					class="button"
					:class="dialog === 'delete' ? 'button--danger' : 'button--primary'"
					type="submit"
					:disabled="submitting"
				>
					{{
						dialog === "delete"
							? "删除"
							: dialog === "publish"
								? "确认发布"
								: "确定"
					}}
				</button>
			</div>
		</form>
	</div>
</template>

<style scoped>
.boot {
	display: grid;
	height: 100%;
	place-items: center;
}

.scrim {
	position: fixed;
	inset: var(--topbar-height) 0 0;
	z-index: 10;
	border: 0;
	background: rgb(0 0 0 / 0.4);
}
</style>
