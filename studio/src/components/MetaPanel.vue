<script setup lang="ts">
import { X } from "@lucide/vue";
import { ref } from "vue";
import type { PostFrontmatter } from "@/types/studio";

const meta = defineModel<PostFrontmatter>("meta", { required: true });

const props = defineProps<{
	categories: string[];
	disabled: boolean;
}>();

const emit = defineEmits<{
	uploadCover: [file: File];
}>();

const tagInput = ref("");
const coverInput = ref<HTMLInputElement | null>(null);

/** 逗号、中文逗号、顿号都当作分隔符，粘贴一串标签时不用逐个敲回车。 */
function commitTags(): void {
	const parts = tagInput.value
		.split(/[,，、]/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (parts.length === 0) return;
	const next = [...meta.value.tags];
	for (const part of parts) {
		if (!next.includes(part)) next.push(part);
	}
	// 没有真的新增标签就不要写回，否则会白白把状态标成「未保存」
	if (next.length === meta.value.tags.length) {
		tagInput.value = "";
		return;
	}
	meta.value = { ...meta.value, tags: next };
	tagInput.value = "";
}

function removeTag(tag: string): void {
	meta.value = {
		...meta.value,
		tags: meta.value.tags.filter((item) => item !== tag),
	};
}

function pickCover(): void {
	coverInput.value?.click();
}

function onCoverChange(event: Event): void {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file) emit("uploadCover", file);
	// 允许连续选同一张图
	input.value = "";
}

function onTagKeydown(event: KeyboardEvent): void {
	if (event.key === "Enter" || event.key === "," || event.key === "、") {
		event.preventDefault();
		commitTags();
	}
}
</script>

<template>
	<aside class="meta">
		<header class="meta__head">
			<span>文章信息</span>
			<span class="muted mono" style="font-size: 0.6875rem; font-weight: 400">
				frontmatter
			</span>
		</header>

		<div class="meta__body">
			<div class="meta__row">
				<label class="field__label" for="meta-published">发布日期</label>
				<input
					id="meta-published"
					v-model="meta.published"
					class="input input--mono"
					type="date"
					:disabled="props.disabled"
				/>
			</div>

			<div class="meta__row">
				<label class="field__label" for="meta-updated">更新日期</label>
				<input
					id="meta-updated"
					v-model="meta.updated"
					class="input input--mono"
					type="date"
					:disabled="props.disabled"
				/>
			</div>

			<div class="meta__row">
				<label class="field__label" for="meta-category">分类</label>
				<input
					id="meta-category"
					v-model="meta.category"
					class="input"
					list="studio-categories"
					placeholder="如：设计文档"
					:disabled="props.disabled"
				/>
				<datalist id="studio-categories">
					<option v-for="item in props.categories" :key="item" :value="item" />
				</datalist>
			</div>

			<div class="meta__row" style="align-items: start">
				<span class="field__label" style="padding-top: 0.4rem">标签</span>
				<div class="tags">
					<span v-for="tag in meta.tags" :key="tag" class="tag">
						{{ tag }}
						<button
							type="button"
							:aria-label="`移除标签 ${tag}`"
							:disabled="props.disabled"
							@click="removeTag(tag)"
						>
							<X :size="10" />
						</button>
					</span>
					<input
						v-model="tagInput"
						type="text"
						placeholder="输入后回车"
						:disabled="props.disabled"
						@keydown="onTagKeydown"
						@blur="commitTags"
					/>
				</div>
			</div>

			<div class="meta__row" style="align-items: start">
				<label class="field__label" for="meta-description" style="padding-top: 0.4rem">
					摘要
				</label>
				<textarea
					id="meta-description"
					v-model="meta.description"
					class="textarea"
					rows="3"
					placeholder="列表页与 og 卡片会用到"
					:disabled="props.disabled"
				/>
			</div>

			<div class="meta__row" style="align-items: start">
				<span class="field__label" style="padding-top: 0.4rem">封面</span>
				<div class="field">
					<div class="cover">
						<span
							class="cover__thumb"
							:style="
								meta.image
									? { backgroundImage: `url('${meta.image}')` }
									: undefined
							"
						/>
						<button
							class="button"
							type="button"
							:disabled="props.disabled"
							@click="pickCover"
						>
							上传
						</button>
					</div>
					<input
						v-model="meta.image"
						class="input input--mono"
						type="text"
						placeholder="./assets/xxx.webp"
						:disabled="props.disabled"
					/>
					<input
						ref="coverInput"
						type="file"
						accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
						hidden
						@change="onCoverChange"
					/>
				</div>
			</div>

			<div class="meta__section">发布</div>

			<label class="switch">
				<input v-model="meta.draft" type="checkbox" :disabled="props.disabled" />
				<span>草稿（不进入线上构建）</span>
			</label>

			<label class="switch">
				<input v-model="meta.pinned" type="checkbox" :disabled="props.disabled" />
				<span>置顶</span>
			</label>

			<label class="switch">
				<input v-model="meta.comment" type="checkbox" :disabled="props.disabled" />
				<span>允许评论</span>
			</label>

			<label class="switch">
				<input
					v-model="meta.wikiExclude"
					type="checkbox"
					:disabled="props.disabled"
				/>
				<span>排除出机器可读 wiki</span>
			</label>

			<div class="meta__section">高级</div>

			<div class="meta__row">
				<label class="field__label" for="meta-author">作者</label>
				<input
					id="meta-author"
					v-model="meta.author"
					class="input"
					:disabled="props.disabled"
				/>
			</div>

			<div class="meta__row">
				<label class="field__label" for="meta-lang">语言</label>
				<input
					id="meta-lang"
					v-model="meta.lang"
					class="input input--mono"
					placeholder="zh_CN"
					:disabled="props.disabled"
				/>
			</div>

			<div class="meta__row">
				<label class="field__label" for="meta-source">来源链接</label>
				<input
					id="meta-source"
					v-model="meta.sourceLink"
					class="input input--mono"
					type="url"
					placeholder="https://"
					:disabled="props.disabled"
				/>
			</div>

			<div class="meta__row">
				<label class="field__label" for="meta-license">许可名称</label>
				<input
					id="meta-license"
					v-model="meta.licenseName"
					class="input"
					placeholder="CC BY 4.0"
					:disabled="props.disabled"
				/>
			</div>

			<div class="meta__row">
				<label class="field__label" for="meta-license-url">许可链接</label>
				<input
					id="meta-license-url"
					v-model="meta.licenseUrl"
					class="input input--mono"
					type="url"
					placeholder="https://"
					:disabled="props.disabled"
				/>
			</div>

			<div class="meta__row">
				<label class="field__label" for="meta-password">访问密码</label>
				<input
					id="meta-password"
					v-model="meta.password"
					class="input input--mono"
					type="text"
					placeholder="留空为公开"
					:disabled="props.disabled"
				/>
			</div>

			<div class="meta__row">
				<label class="field__label" for="meta-hint">密码提示</label>
				<input
					id="meta-hint"
					v-model="meta.passwordHint"
					class="input"
					:disabled="props.disabled"
				/>
			</div>
		</div>
	</aside>
</template>
