/**
 * 写作后台（studio）与其 Node 服务端之间的传输契约。
 *
 * 前后端共用这一份定义：服务端在 tsconfig 的 include 范围内，会被
 * `pnpm check` 一并校验；前端经 Vite 别名直接引入，避免两端各写一套
 * 结构后悄悄漂移。
 *
 * 这里只描述数据的形状，不放任何运行时逻辑。
 */

/** 后台表单直接管理的 frontmatter 字段，键与 content.config.ts 的 schema 对齐。 */
export type PostFrontmatter = {
	title: string;
	published: string;
	updated: string;
	draft: boolean;
	description: string;
	image: string;
	tags: string[];
	category: string;
	lang: string;
	pinned: boolean;
	author: string;
	sourceLink: string;
	licenseName: string;
	licenseUrl: string;
	comment: boolean;
	password: string;
	passwordHint: string;
	wikiExclude: boolean;
};

/** 列表页用的文章摘要，不含正文。 */
export type PostSummary = {
	/** 相对 src/content/posts 的路径，不含扩展名，即文章 URL 里的 slug。 */
	slug: string;
	extension: PostExtension;
	title: string;
	published: string;
	updated: string;
	draft: boolean;
	pinned: boolean;
	category: string;
	tags: string[];
	/** 中英文混排的字数估算，用于列表排序与写作统计。 */
	words: number;
	/**
	 * frontmatter 无法解析时的原因。列表不会因为一篇坏文件就把它藏起来，
	 * 否则用户会以为文章丢了；带上原因让列表能显示为「读取失败」。
	 */
	error?: string;
};

export type PostExtension = ".md" | ".mdx";

/** 单篇文章的完整内容。 */
export type PostDocument = {
	slug: string;
	extension: PostExtension;
	frontmatter: PostFrontmatter;
	/**
	 * 磁盘上存在、但表单未覆盖的字段。保存时原样带回，
	 * 免得手写加的字段被后台悄悄抹掉。
	 */
	extra: Record<string, unknown>;
	body: string;
	/** 文件内容摘要，保存时用于发现「磁盘已被其他途径改动」并提示冲突。 */
	revision: string;
};

export type SavePostPayload = {
	frontmatter: Partial<PostFrontmatter>;
	body: string;
	/** 打开文章时拿到的 revision；与磁盘不一致即判定为冲突。 */
	revision: string;
};

export type CreatePostPayload = {
	slug: string;
	title?: string;
};

export type RenamePostPayload = {
	from: string;
	to: string;
};

export type UploadResult = {
	/** 落盘后的文件名。 */
	name: string;
	/** 可直接写进 Markdown 的相对路径，例如 ./assets/foo-bar.webp */
	url: string;
	bytes: number;
};

export type PublishResult = {
	ok: true;
	status: "published" | "up-to-date";
	commit?: string;
	detail: string;
};

export type SessionInfo = {
	authenticated: boolean;
	/** 博客 dev server 的地址，用于「在博客中查看」跳转。 */
	previewOrigin: string;
};

export type ApiError = {
	error: string;
};
