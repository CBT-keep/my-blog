<script setup lang="ts">
import { Plus } from "@lucide/vue";
import { computed } from "vue";
import type { PostSummary } from "@/types/studio";

const search = defineModel<string>("search", { required: true });

const props = defineProps<{
	posts: PostSummary[];
	activeSlug: string | null;
}>();

const emit = defineEmits<{
	select: [slug: string];
	create: [];
}>();

/** 搜索同时匹配标题、slug、分类与标签，写长文时按分类找旧文比按标题更好用。 */
const filtered = computed(() => {
	const keyword = search.value.trim().toLowerCase();
	if (!keyword) return props.posts;
	return props.posts.filter((post) => {
		const haystack = [post.title, post.slug, post.category, ...post.tags]
			.join(" ")
			.toLowerCase();
		return haystack.includes(keyword);
	});
});

function formatDate(value: string): string {
	return value || "未填日期";
}
</script>

<template>
	<aside class="sidebar">
		<div class="sidebar__head">
			<input
				v-model="search"
				class="input"
				type="search"
				placeholder="搜索标题、分类、标签"
				aria-label="搜索文章"
			/>
			<button
				class="button button--primary button--icon"
				type="button"
				title="新建文章"
				aria-label="新建文章"
				@click="emit('create')"
			>
				<Plus :size="15" />
			</button>
		</div>

		<ul class="sidebar__list">
			<li v-for="post in filtered" :key="post.slug">
				<button
					class="post-item"
					type="button"
					:aria-current="post.slug === activeSlug"
					:disabled="Boolean(post.error)"
					:title="post.error ? `${post.slug}：${post.error}` : post.slug"
					@click="emit('select', post.slug)"
				>
					<span class="post-item__title">{{ post.title }}</span>
					<span class="post-item__meta">
						<template v-if="post.error">
							<span class="badge badge--error">读取失败</span>
							<span class="muted">需手工检查该文件</span>
						</template>
						<template v-else>
							<span>{{ formatDate(post.published) }}</span>
							<span v-if="post.draft" class="badge badge--draft">草稿</span>
							<span v-if="post.pinned" class="badge badge--pinned">置顶</span>
							<span v-if="post.category">{{ post.category }}</span>
							<span class="muted">{{ post.words }} 字</span>
						</template>
					</span>
				</button>
			</li>
			<li v-if="filtered.length === 0" class="muted" style="padding: 0.75rem">
				{{ posts.length === 0 ? "还没有文章" : "没有匹配的文章" }}
			</li>
		</ul>
	</aside>
</template>
