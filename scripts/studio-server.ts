#!/usr/bin/env node
/**
 * 写作后台服务端（studio）。
 *
 * 用法:
 *   pnpm studio           开发模式，Vite 中间件接管前端，带 HMR
 *   pnpm studio:serve     生产模式，直接托管 studio/dist 静态产物
 *
 * 环境变量:
 *   STUDIO_TOKEN      登录口令。未设置时随机生成并打印在启动日志里
 *   STUDIO_PORT       监听端口，默认 4400
 *   STUDIO_HOST       监听地址，默认 127.0.0.1；
 *                      需要在其他设备访问时设为 0.0.0.0
 *   STUDIO_PREVIEW_ORIGIN  博客 dev server 地址，默认 http://localhost:4399
 *   STUDIO_GIT_REMOTE 发布时使用的 Git remote，默认 origin
 *   STUDIO_GIT_BRANCH 发布时推送的分支，默认 main
 *
 * 设计约束:
 *   - 所有文件写入都经过 resolvePostFile / resolveUploadFile 的路径校验，
 *     只允许落在 src/content/posts 之内，杜绝 ../ 穿越与软链逃逸。
 *   - frontmatter 里表单未覆盖的字段原样带回，避免后台抹掉手写内容。
 *   - 保存时比对 revision，磁盘被其他途径改动过就报冲突而不是静默覆盖。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import http from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import matter from "gray-matter";
import type { ViteDevServer } from "vite";
import type {
	PostDocument,
	PostExtension,
	PostFrontmatter,
	PostSummary,
	SessionInfo,
	UploadResult,
} from "../src/types/studio";
import { countWords } from "../src/utils/word-count";

const REPO_ROOT = process.cwd();
const POSTS_DIR = path.join(REPO_ROOT, "src", "content", "posts");
const ASSETS_DIR = path.join(POSTS_DIR, "assets");
const STUDIO_DIR = path.join(REPO_ROOT, "studio");
const DIST_DIR = path.join(STUDIO_DIR, "dist");

const DEFAULT_PORT = 4400;
const DEFAULT_PREVIEW_ORIGIN = "http://localhost:4399";
const COOKIE_NAME = "studio_session";
const GIT_REMOTE = process.env.STUDIO_GIT_REMOTE?.trim() || "origin";
const GIT_BRANCH = process.env.STUDIO_GIT_BRANCH?.trim() || "main";
/** JSON 请求体上限；图片走裸流，单独放宽。 */
const JSON_BODY_LIMIT = 4 * 1024 * 1024;
const UPLOAD_BODY_LIMIT = 32 * 1024 * 1024;
const SLUG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._\-/]*$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type FieldKind = "string" | "boolean" | "array" | "date";

/**
 * 后台管理的字段及其写回顺序。
 *
 * 顺序贴着仓库既有文章的样子排（标题、封面、日期在前，元信息与开关在后），
 * 免得后台每保存一次就把 frontmatter 整体重排、制造无意义的 diff。
 * required 表示该字段始终输出：schema 里 title 与 published 是必填的。
 * schemaDefault 是 content.config.ts 里该字段的默认值，布尔字段与默认值相同时
 * 不落盘（comment 默认就是 true，没必要每篇都写一遍）。
 */
const MANAGED_FIELDS: ReadonlyArray<{
	key: string;
	kind: FieldKind;
	required?: boolean;
	schemaDefault?: boolean;
}> = [
	{ key: "title", kind: "string", required: true },
	{ key: "image", kind: "string" },
	{ key: "published", kind: "date", required: true },
	{ key: "updated", kind: "date" },
	{ key: "description", kind: "string" },
	{ key: "tags", kind: "array" },
	{ key: "category", kind: "string" },
	{ key: "draft", kind: "boolean", schemaDefault: false },
	{ key: "pinned", kind: "boolean", schemaDefault: false },
	{ key: "lang", kind: "string" },
	{ key: "author", kind: "string" },
	{ key: "sourceLink", kind: "string" },
	{ key: "licenseName", kind: "string" },
	{ key: "licenseUrl", kind: "string" },
	{ key: "comment", kind: "boolean", schemaDefault: true },
	{ key: "password", kind: "string" },
	{ key: "passwordHint", kind: "string" },
	{ key: "wikiExclude", kind: "boolean", schemaDefault: false },
];

const MANAGED_FIELD_KEYS: ReadonlySet<string> = new Set(
	MANAGED_FIELDS.map((field) => field.key),
);

/** 按 content-type 决定落盘扩展名，避免前端传来的文件名决定实际格式。 */
const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
	["image/png", ".png"],
	["image/jpeg", ".jpg"],
	["image/gif", ".gif"],
	["image/webp", ".webp"],
	["image/avif", ".avif"],
]);

loadEnvironment();

const PORT = readPort(process.env.STUDIO_PORT);
const HOST = process.env.STUDIO_HOST?.trim() || "127.0.0.1";
const PREVIEW_ORIGIN = (
	process.env.STUDIO_PREVIEW_ORIGIN?.trim() || DEFAULT_PREVIEW_ORIGIN
).replace(/\/+$/, "");
/** 口令只从环境变量读；未配置时随机生成一次性口令并打印，不落盘、不给默认值。 */
const TOKEN =
	process.env.STUDIO_TOKEN?.trim() || randomBytes(24).toString("hex");
const IS_GENERATED_TOKEN = !process.env.STUDIO_TOKEN?.trim();
const IS_PRODUCTION = process.env.STUDIO_MODE === "production";

let isPublishing = false;

const execFileAsync = promisify(execFile);

function loadEnvironment(): void {
	if (existsSync(path.join(REPO_ROOT, ".env"))) {
		process.loadEnvFile(path.join(REPO_ROOT, ".env"));
	}
}

function readPort(value: string | undefined): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
		? parsed
		: DEFAULT_PORT;
}

/* -------------------------------------------------------------------------- */
/* 发布到 GitHub                                                               */
/* -------------------------------------------------------------------------- */

async function runGit(args: string[]): Promise<string> {
	const { stdout, stderr } = await execFileAsync("git", args, {
		cwd: REPO_ROOT,
		env: process.env,
		maxBuffer: 4 * 1024 * 1024,
	});
	return `${stdout}${stderr}`.trim();
}

function describeGitError(error: unknown): string {
	const record = asRecord(error);
	const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
	const message = error instanceof Error ? error.message : "";
	const text = stderr || message || "Git 命令执行失败";
	return text.split("\n").slice(-4).join("\n");
}

async function publishPosts(): Promise<{
	status: "published" | "up-to-date";
	commit?: string;
	detail: string;
}> {
	if (isPublishing) {
		throw new HttpError(409, "发布正在进行中");
	}

	isPublishing = true;
	try {
		try {
			await runGit(["rev-parse", "--is-inside-work-tree"]);
		} catch {
			throw new HttpError(
				500,
				"服务器上的博客目录不是 Git 仓库，无法发布到 GitHub",
			);
		}

		await runGit(["add", "--", "src/content/posts"]);
		const staged = await runGit([
			"diff",
			"--cached",
			"--name-only",
			"--",
			"src/content/posts",
		]);

		if (staged) {
			const message = `content: publish posts ${new Date()
				.toISOString()
				.slice(0, 10)}`;
			await runGit([
				"-c",
				"user.name=Blog Studio",
				"-c",
				"user.email=blog-studio@localhost",
				"commit",
				"-m",
				message,
			]);
		}

		await runGit(["push", GIT_REMOTE, `HEAD:${GIT_BRANCH}`]);
		const commit = await runGit(["rev-parse", "--short", "HEAD"]);
		return staged
			? {
					status: "published",
					commit,
					detail: "已提交到 GitHub，等待构建完成",
				}
			: {
					status: "up-to-date",
					commit,
					detail: "没有新的文章改动，已确认与 GitHub 同步",
				};
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(500, describeGitError(error));
	} finally {
		isPublishing = false;
	}
}

/* -------------------------------------------------------------------------- */
/* HTTP 基础设施                                                                */
/* -------------------------------------------------------------------------- */

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
	});
	res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string): void {
	sendJson(res, status, { error: message });
}

function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let exceeded = false;
		req.on("data", (chunk: Buffer) => {
			if (exceeded) return;
			size += chunk.length;
			if (size > limit) {
				exceeded = true;
				reject(
					new HttpError(
						413,
						`请求体超出 ${Math.round(limit / 1024 / 1024)}MB 上限`,
					),
				);
				// 不能在这里 destroy：socket 被掐掉后 413 就写不回客户端了。
				// 继续把剩余数据读掉（上面的 exceeded 分支直接丢弃），
				// 让全局错误处理有机会把响应发出去。
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	const raw = await readRawBody(req, JSON_BODY_LIMIT);
	if (raw.length === 0) return {};
	try {
		return JSON.parse(raw.toString("utf-8"));
	} catch {
		throw new HttpError(400, "请求体不是合法的 JSON");
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean {
	return value === true;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/* -------------------------------------------------------------------------- */
/* 鉴权                                                                        */
/* -------------------------------------------------------------------------- */

function readCookie(req: IncomingMessage, name: string): string {
	const header = req.headers.cookie;
	if (!header) return "";
	for (const part of header.split(";")) {
		const index = part.indexOf("=");
		if (index < 0) continue;
		if (part.slice(0, index).trim() === name) {
			return decodeURIComponent(part.slice(index + 1).trim());
		}
	}
	return "";
}

function isAuthorized(req: IncomingMessage): boolean {
	const provided = readCookie(req, COOKIE_NAME);
	const expected = Buffer.from(TOKEN);
	const actual = Buffer.from(provided);
	if (expected.length !== actual.length) return false;
	return timingSafeEqual(expected, actual);
}

function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
	if (isAuthorized(req)) return true;
	sendError(res, 401, "未登录或口令已失效");
	return false;
}

/* -------------------------------------------------------------------------- */
/* 路径校验：所有磁盘写入都必须过这一层                                        */
/* -------------------------------------------------------------------------- */

function isValidSlug(slug: string): boolean {
	if (!slug || slug.length > 180) return false;
	if (slug.includes("\\") || slug.startsWith("/") || path.isAbsolute(slug)) {
		return false;
	}
	const segments = slug.split("/");
	return (
		segments.every(
			(segment) => segment !== "" && segment !== "." && segment !== "..",
		) && SLUG_PATTERN.test(slug)
	);
}

/**
 * 解析 slug 对应的文章文件，同时用 realpath 校验软链逃逸：
 * 软链本身合法（Astro 内容目录里可能用到），但它指向的目录必须在 posts 之内。
 */
async function resolvePostFile(
	slug: string,
	extension?: PostExtension,
): Promise<{ absolutePath: string; extension: PostExtension }> {
	if (!isValidSlug(slug)) {
		throw new HttpError(400, "文章路径不合法");
	}
	const extensionPattern = /\.(md|mdx)$/i;
	const matched = extensionPattern.exec(slug);
	const normalizedSlug = matched ? slug.slice(0, matched.index) : slug;
	const resolvedExtension: PostExtension = extension
		? extension
		: matched
			? (matched[0].toLowerCase() as PostExtension)
			: ".md";

	if (!isValidSlug(normalizedSlug)) {
		throw new HttpError(400, "文章路径不合法");
	}
	const absolutePath = path.join(
		POSTS_DIR,
		`${normalizedSlug}${resolvedExtension}`,
	);
	if (!isInsidePosts(absolutePath)) {
		throw new HttpError(400, "目标路径超出文章目录");
	}
	return { absolutePath, extension: resolvedExtension };
}

function isInsidePosts(target: string): boolean {
	const relative = path.relative(POSTS_DIR, target);
	return (
		relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
	);
}

/** 目录已存在时确认它的真实路径仍在 posts 内，挡住软链逃逸。 */
async function assertRealPathInsidePosts(target: string): Promise<void> {
	let real: string;
	try {
		real = await fs.realpath(target);
	} catch {
		return;
	}
	let realPosts = POSTS_DIR;
	try {
		realPosts = await fs.realpath(POSTS_DIR);
	} catch {
		return;
	}
	const relative = path.relative(realPosts, real);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new HttpError(400, "目标路径通过软链逃出了文章目录");
	}
}

class HttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "HttpError";
		this.status = status;
	}
}

/* -------------------------------------------------------------------------- */
/* frontmatter 读写                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 统一转成 YYYY-MM-DD。
 *
 * 用 UTC 而非本地时区取日期：裸日期 `2026-08-21` 被 YAML 解析成 UTC 零点，
 * 若按本地时区格式化，负时区用户每保存一次日期就会退一天。
 */
function toDateString(value: unknown): string {
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value.toISOString().slice(0, 10);
	}
	if (typeof value === "string" && value.trim()) {
		return value.trim().slice(0, 10);
	}
	return "";
}

function parseFrontmatter(data: Record<string, unknown>): {
	frontmatter: PostFrontmatter;
	extra: Record<string, unknown>;
} {
	const frontmatter: PostFrontmatter = {
		title: asString(data.title),
		published: toDateString(data.published),
		updated: toDateString(data.updated),
		draft: asBoolean(data.draft),
		description: asString(data.description),
		image: asString(data.image),
		tags: asStringArray(data.tags),
		category: asString(data.category),
		lang: asString(data.lang),
		pinned: asBoolean(data.pinned),
		author: asString(data.author),
		sourceLink: asString(data.sourceLink),
		licenseName: asString(data.licenseName),
		licenseUrl: asString(data.licenseUrl),
		comment: data.comment === undefined ? true : asBoolean(data.comment),
		password: asString(data.password),
		passwordHint: asString(data.passwordHint),
		wikiExclude: asBoolean(data.wikiExclude),
	};

	const extra: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (!MANAGED_FIELD_KEYS.has(key)) extra[key] = value;
	}
	return { frontmatter, extra };
}

/**
 * 组装写回磁盘的 frontmatter。
 *
 * 空值字段会被删掉而不是写成空串，这样新文章不会带一堆 `category: ""`；
 * 但原文件本就存在的键（哪怕值是 false / 空数组）会保留原样，避免无意改写。
 */
function buildFrontmatterData(
	frontmatter: Record<string, unknown>,
	extra: Record<string, unknown>,
	originalKeys: ReadonlySet<string>,
): Record<string, unknown> {
	const data: Record<string, unknown> = { ...extra };

	for (const field of MANAGED_FIELDS) {
		const raw = frontmatter[field.key];
		if (field.kind === "boolean") {
			// 字段在输入里完全不存在时不能按 false 处理：
			// comment 的 schema 默认值是 true，写成 false 会把评论悄悄关掉
			if (!(field.key in frontmatter) && !originalKeys.has(field.key)) {
				delete data[field.key];
				continue;
			}
			const value = asBoolean(raw);
			if (
				value !== (field.schemaDefault ?? false) ||
				originalKeys.has(field.key)
			) {
				data[field.key] = value;
			} else {
				delete data[field.key];
			}
			continue;
		}
		if (field.kind === "array") {
			const value = asStringArray(raw);
			if (value.length > 0 || originalKeys.has(field.key)) {
				data[field.key] = value;
			} else {
				delete data[field.key];
			}
			continue;
		}
		const value = field.kind === "date" ? asString(raw).trim() : asString(raw);
		if (field.required) {
			data[field.key] = value;
		} else if (value) {
			data[field.key] = value;
		} else {
			delete data[field.key];
		}
	}

	return data;
}

/**
 * 序列化整篇文章。
 *
 * gray-matter 走 js-yaml：日期若以字符串传入会被加上引号输出，
 * 读回来就成了字符串，过不了 content.config.ts 的 z.date()。
 * 所以这里统一把两个日期键还原成 YAML 的裸日期写法。
 */
function serializePost(
	frontmatter: Record<string, unknown>,
	extra: Record<string, unknown>,
	originalKeys: ReadonlySet<string>,
	body: string,
): string {
	const data = buildFrontmatterData(frontmatter, extra, originalKeys);
	return matter
		.stringify(body, data)
		.replace(/^(\s*(?:published|updated):\s*)'([^']+)'$/gm, "$1$2");
}

function validateFrontmatter(frontmatter: Record<string, unknown>): void {
	if (!asString(frontmatter.title).trim()) {
		throw new HttpError(400, "标题不能为空");
	}
	const published = asString(frontmatter.published).trim();
	if (!DATE_PATTERN.test(published)) {
		throw new HttpError(400, "发布日期需为 YYYY-MM-DD");
	}
	const updated = asString(frontmatter.updated).trim();
	if (updated && !DATE_PATTERN.test(updated)) {
		throw new HttpError(400, "更新日期需为 YYYY-MM-DD");
	}
}

/* -------------------------------------------------------------------------- */
/* 文章读取                                                                    */
/* -------------------------------------------------------------------------- */

async function walkPostFiles(dir: string, prefix = ""): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		// 素材目录与点开头的目录不是文章，跳过以免把图片当 markdown 读
		if (entry.name.startsWith(".")) continue;
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (entry.name === "assets" || entry.name === "image") continue;
			files.push(
				...(await walkPostFiles(path.join(dir, entry.name), relative)),
			);
			continue;
		}
		if (/\.(md|mdx)$/i.test(entry.name)) files.push(relative);
	}
	return files;
}

async function readPostDocument(
	absolutePath: string,
	slug: string,
	extension: PostExtension,
): Promise<PostDocument> {
	return (await readPostWithKeys(absolutePath, slug, extension)).document;
}

/** 保存路径需要知道原文件真实存在哪些键，故与读取路径共用同一个解析函数。 */
async function readPostWithKeys(
	absolutePath: string,
	slug: string,
	extension: PostExtension,
): Promise<{ document: PostDocument; originalKeys: Set<string> }> {
	const raw = await fs.readFile(absolutePath, "utf-8");
	return parsePostFile(raw, slug, extension);
}

/**
 * 解析一篇文章，同时把「原文件里真实存在哪些 frontmatter 键」带出来。
 * 保存时靠它判断某个空值字段是该删掉还是该原样保留。
 */
function parsePostFile(
	raw: string,
	slug: string,
	extension: PostExtension,
): { document: PostDocument; originalKeys: Set<string> } {
	const { data, content } = matter(raw);
	const record = asRecord(data);
	const { frontmatter, extra } = parseFrontmatter(record);
	return {
		document: {
			slug,
			extension,
			frontmatter,
			extra,
			body: content.replace(/^\n+/, ""),
			revision: createHash("sha256").update(raw).digest("hex").slice(0, 16),
		},
		originalKeys: new Set(Object.keys(record)),
	};
}

async function listPosts(): Promise<PostSummary[]> {
	const relativePaths = (await walkPostFiles(POSTS_DIR)).sort();
	const summaries = await Promise.all(
		relativePaths.map(async (relativePath): Promise<PostSummary> => {
			// 读取失败也要在列表里留一条带 error 的记录：
			// 文章从列表里凭空消失，比显示一条「读取失败」更让人慌
			const fallback: PostSummary = {
				slug: relativePath.replace(/\.(md|mdx)$/i, ""),
				extension: /\.mdx$/i.test(relativePath) ? ".mdx" : ".md",
				title: relativePath.replace(/\.(md|mdx)$/i, ""),
				published: "",
				updated: "",
				draft: false,
				pinned: false,
				category: "",
				tags: [],
				words: 0,
			};
			try {
				// 扩展名由 resolvePostFile 判定，slug 就是去掉扩展名的相对路径
				const { absolutePath, extension } = await resolvePostFile(relativePath);
				const slug = relativePath.slice(
					0,
					relativePath.length - extension.length,
				);
				const doc = await readPostDocument(absolutePath, slug, extension);
				return {
					slug,
					extension,
					title: doc.frontmatter.title || slug,
					published: doc.frontmatter.published,
					updated: doc.frontmatter.updated,
					draft: doc.frontmatter.draft,
					pinned: doc.frontmatter.pinned,
					category: doc.frontmatter.category,
					tags: doc.frontmatter.tags,
					words: countWords(doc.body),
				};
			} catch (error) {
				return {
					...fallback,
					error: error instanceof Error ? error.message : "读取失败",
				};
			}
		}),
	);
	return summaries;
}

/* -------------------------------------------------------------------------- */
/* API 处理                                                                    */
/* -------------------------------------------------------------------------- */

async function handleListPosts(res: ServerResponse): Promise<void> {
	sendJson(res, 200, await listPosts());
}

async function handleGetPost(res: ServerResponse, slug: string): Promise<void> {
	const { absolutePath, extension } = await resolvePostFile(slug);
	await assertRealPathInsidePosts(path.dirname(absolutePath));
	if (!(await pathExists(absolutePath))) {
		throw new HttpError(404, "文章不存在");
	}
	sendJson(res, 200, await readPostDocument(absolutePath, slug, extension));
}

async function handleSavePost(
	req: IncomingMessage,
	res: ServerResponse,
	slug: string,
): Promise<void> {
	const payload = asRecord(await readJson(req));
	const frontmatter = asRecord(payload.frontmatter);
	const revision = asString(payload.revision);
	// body 缺失时不能当成空字符串：那会把整篇正文清空，属于静默数据丢失
	if (typeof payload.body !== "string") {
		throw new HttpError(400, "缺少 body 字段，拒绝保存以免清空正文");
	}
	// revision 缺失就无从判断磁盘是否已被改动，直接拒绝而不是跳过冲突检测
	if (!revision) {
		throw new HttpError(400, "缺少 revision，请重新加载文章后再保存");
	}
	const body = payload.body;
	validateFrontmatter(frontmatter);

	const { absolutePath, extension } = await resolvePostFile(slug);
	await assertRealPathInsidePosts(path.dirname(absolutePath));
	if (!(await pathExists(absolutePath))) {
		throw new HttpError(404, "文章不存在");
	}

	const { document: current, originalKeys } = await readPostWithKeys(
		absolutePath,
		slug,
		extension,
	);
	if (current.revision !== revision) {
		throw new HttpError(
			409,
			"磁盘上的文章已被其他途径修改，请重新加载后再保存",
		);
	}

	const next = serializePost(
		{ ...current.frontmatter, ...frontmatter },
		current.extra,
		originalKeys,
		body,
	);
	await writeFileAtomic(absolutePath, next);
	sendJson(res, 200, await readPostDocument(absolutePath, slug, extension));
}

async function handleCreatePost(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const payload = asRecord(await readJson(req));
	const slug = asString(payload.slug).trim();
	const { absolutePath, extension } = await resolvePostFile(slug);
	await assertRealPathInsidePosts(path.dirname(absolutePath));
	if (await pathExists(absolutePath)) {
		throw new HttpError(409, "同名文章已存在");
	}
	// .mdx 入口已存在时说明 slug 实际被另一篇文章占用
	const otherExtension: PostExtension = extension === ".md" ? ".mdx" : ".md";
	const otherPath = absolutePath.slice(0, -extension.length) + otherExtension;
	if (await pathExists(otherPath)) {
		throw new HttpError(409, "同名文章已存在");
	}

	const title = asString(payload.title).trim() || slug;
	const published = new Date().toISOString().slice(0, 10);
	// 新文章一律先落成草稿：没写完的内容不该被构建进线上站点
	const content = serializePost(
		{ title, published, draft: true },
		{},
		new Set(["title", "published", "draft"]),
		"",
	);
	await fs.mkdir(path.dirname(absolutePath), { recursive: true });
	await writeFileAtomic(absolutePath, content);
	sendJson(res, 201, await readPostDocument(absolutePath, slug, extension));
}

async function handleRenamePost(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const payload = asRecord(await readJson(req));
	const from = asString(payload.from).trim();
	const to = asString(payload.to).trim();
	const source = await resolvePostFile(from);
	const target = await resolvePostFile(to, source.extension);
	await assertRealPathInsidePosts(path.dirname(source.absolutePath));
	await assertRealPathInsidePosts(path.dirname(target.absolutePath));
	if (!(await pathExists(source.absolutePath))) {
		throw new HttpError(404, "原文章不存在");
	}
	if (await pathExists(target.absolutePath)) {
		throw new HttpError(409, "目标文章已存在");
	}
	await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
	await fs.rename(source.absolutePath, target.absolutePath);
	// 目录迁移后清掉空目录，避免文章挪走后留下一串空壳
	await pruneEmptyDirs(path.dirname(source.absolutePath));
	sendJson(
		res,
		200,
		await readPostDocument(target.absolutePath, to, target.extension),
	);
}

async function handleDeletePost(
	res: ServerResponse,
	slug: string,
): Promise<void> {
	const { absolutePath } = await resolvePostFile(slug);
	await assertRealPathInsidePosts(path.dirname(absolutePath));
	if (!(await pathExists(absolutePath))) {
		throw new HttpError(404, "文章不存在");
	}
	await fs.unlink(absolutePath);
	await pruneEmptyDirs(path.dirname(absolutePath));
	sendJson(res, 200, { ok: true });
}

async function pruneEmptyDirs(start: string): Promise<void> {
	let current = start;
	while (isInsidePosts(current)) {
		try {
			const entries = await fs.readdir(current);
			if (entries.length > 0) return;
			await fs.rmdir(current);
		} catch {
			return;
		}
		current = path.dirname(current);
	}
}

/* -------------------------------------------------------------------------- */
/* 图片上传                                                                    */
/* -------------------------------------------------------------------------- */

/** 嗅探文件头判断真实类型，不信任前端给的 content-type 与扩展名。 */
function sniffImageType(buffer: Buffer): string | null {
	if (
		buffer.length > 8 &&
		buffer
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	) {
		return "image/png";
	}
	if (
		buffer.length > 3 &&
		buffer[0] === 0xff &&
		buffer[1] === 0xd8 &&
		buffer[2] === 0xff
	) {
		return "image/jpeg";
	}
	if (buffer.length > 6) {
		const signature = buffer.subarray(0, 6).toString("latin1");
		if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
	}
	if (
		buffer.length > 12 &&
		buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
		buffer.subarray(8, 12).toString("latin1") === "WEBP"
	) {
		return "image/webp";
	}
	if (
		buffer.length > 12 &&
		buffer.subarray(4, 8).toString("latin1") === "ftyp"
	) {
		// 兼容品牌列表从 ftyp box 的第 16 字节起，扫前 64 字节足够覆盖
		const head = buffer.subarray(8, 64).toString("latin1");
		if (head.includes("avif") || head.includes("avis")) return "image/avif";
	}
	return null;
}

function sanitizeImageBaseName(rawName: string, fallback: string): string {
	const base = path
		.basename(rawName)
		.replace(/\.[^.]+$/, "")
		.replace(/[^\p{L}\p{N}._-]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return base || fallback;
}

/**
 * 文章内图片引用统一写相对路径 `./assets/xxx`。
 * 文章本身可能放在子目录里，所以按 slug 深度决定要回退几级 `../`。
 */
function buildImageUrl(slug: string, fileName: string): string {
	const depth = slug.split("/").length - 1;
	const prefix =
		depth === 0 ? "." : Array.from({ length: depth }, () => "..").join("/");
	return `${prefix}/assets/${fileName}`;
}

async function handleUpload(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
): Promise<void> {
	const slug = url.searchParams.get("slug") ?? "";
	// 校验 slug 只是为了拿到正确的相对路径前缀，不要求文章已存在，
	// 这样新建文章时也能先传图
	if (!isValidSlug(slug)) {
		throw new HttpError(400, "文章路径不合法");
	}
	const body = await readRawBody(req, UPLOAD_BODY_LIMIT);
	if (body.length === 0) {
		throw new HttpError(400, "上传内容为空");
	}
	const sniffed = sniffImageType(body);
	const extension = sniffed ? IMAGE_EXTENSIONS.get(sniffed) : undefined;
	if (!sniffed || !extension) {
		throw new HttpError(415, "仅支持 PNG / JPEG / GIF / WebP / AVIF 图片");
	}
	if (body.length > 20 * 1024 * 1024) {
		throw new HttpError(413, "单张图片请控制在 20MB 以内");
	}

	await assertRealPathInsidePosts(ASSETS_DIR);
	await fs.mkdir(ASSETS_DIR, { recursive: true });
	const stem = sanitizeImageBaseName(
		url.searchParams.get("name") ?? "",
		slug.split("/").pop() ?? "image",
	);
	let fileName = `${stem}${extension}`;
	let suffix = 1;
	while (await pathExists(path.join(ASSETS_DIR, fileName))) {
		suffix += 1;
		fileName = `${stem}-${suffix}${extension}`;
	}
	const target = path.join(ASSETS_DIR, fileName);
	if (!isInsidePosts(target)) {
		throw new HttpError(400, "目标路径超出文章目录");
	}
	await writeFileAtomic(target, body);

	const result: UploadResult = {
		name: fileName,
		url: buildImageUrl(slug, fileName),
		bytes: body.length,
	};
	sendJson(res, 201, result);
}

/* -------------------------------------------------------------------------- */
/* 落盘：先写临时文件再 rename，避免写到一半被读到残缺内容                    */
/* -------------------------------------------------------------------------- */

async function writeFileAtomic(
	target: string,
	content: string | Buffer,
): Promise<void> {
	const temporary = `${target}.studio-tmp`;
	await fs.writeFile(temporary, content);
	await fs.rename(temporary, target);
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

/* -------------------------------------------------------------------------- */
/* 路由                                                                        */
/* -------------------------------------------------------------------------- */

async function handleApi(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
): Promise<boolean> {
	const { pathname } = url;
	const method = req.method ?? "GET";

	if (pathname === "/api/session" && method === "GET") {
		const info: SessionInfo = {
			authenticated: isAuthorized(req),
			previewOrigin: PREVIEW_ORIGIN,
		};
		sendJson(res, 200, info);
		return true;
	}

	if (pathname === "/api/login" && method === "POST") {
		const payload = asRecord(await readJson(req));
		const provided = asString(payload.token);
		const expected = Buffer.from(TOKEN);
		const actual = Buffer.from(provided);
		const matched =
			expected.length === actual.length && timingSafeEqual(expected, actual);
		if (!matched) {
			throw new HttpError(401, "口令不正确");
		}
		res.setHeader(
			"set-cookie",
			`${COOKIE_NAME}=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
		);
		sendJson(res, 200, { ok: true });
		return true;
	}

	if (pathname === "/api/logout" && method === "POST") {
		res.setHeader(
			"set-cookie",
			`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
		);
		sendJson(res, 200, { ok: true });
		return true;
	}

	if (!pathname.startsWith("/api/")) return false;
	if (!requireAuth(req, res)) return true;

	if (pathname === "/api/publish" && method === "POST") {
		sendJson(res, 200, {
			ok: true,
			...(await publishPosts()),
		});
		return true;
	}

	if (pathname === "/api/posts" && method === "GET") {
		await handleListPosts(res);
		return true;
	}
	if (pathname === "/api/posts" && method === "POST") {
		await handleCreatePost(req, res);
		return true;
	}
	if (pathname === "/api/posts/rename" && method === "POST") {
		await handleRenamePost(req, res);
		return true;
	}
	if (pathname === "/api/upload" && method === "POST") {
		await handleUpload(req, res, url);
		return true;
	}

	const postMatch = /^\/api\/posts\/(.+)$/.exec(pathname);
	if (postMatch) {
		const slug = decodeURIComponent(postMatch[1]);
		if (method === "GET") {
			await handleGetPost(res, slug);
			return true;
		}
		if (method === "PUT") {
			await handleSavePost(req, res, slug);
			return true;
		}
		if (method === "DELETE") {
			await handleDeletePost(res, slug);
			return true;
		}
	}

	throw new HttpError(404, "接口不存在");
}

/* -------------------------------------------------------------------------- */
/* 静态资源：生产模式托管 dist，开发模式交给 Vite                             */
/* -------------------------------------------------------------------------- */

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
	[".html", "text/html; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".css", "text/css; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".svg", "image/svg+xml"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".webp", "image/webp"],
	[".avif", "image/avif"],
	[".woff2", "font/woff2"],
	[".map", "application/json; charset=utf-8"],
]);

async function serveStatic(
	res: ServerResponse,
	pathname: string,
): Promise<void> {
	const relative = pathname === "/" ? "index.html" : pathname.slice(1);
	let target = path.join(DIST_DIR, relative);
	if (!isInside(DIST_DIR, target) || !(await pathExists(target))) {
		// 单页应用：未命中的路径回落到 index.html，交给前端路由
		target = path.join(DIST_DIR, "index.html");
	}
	const body = await fs.readFile(target);
	res.writeHead(200, {
		"content-type":
			CONTENT_TYPES.get(path.extname(target)) ?? "application/octet-stream",
		"cache-control": target.endsWith("index.html")
			? "no-store"
			: "public, max-age=3600",
	});
	res.end(body);
}

function isInside(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return (
		relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
	);
}

/* -------------------------------------------------------------------------- */
/* 启动                                                                        */
/* -------------------------------------------------------------------------- */

async function createRequestHandler(
	vite: ViteDevServer | null,
): Promise<(req: IncomingMessage, res: ServerResponse) => Promise<void>> {
	return async (req, res) => {
		const url = new URL(
			req.url ?? "/",
			`http://${req.headers.host ?? "localhost"}`,
		);
		try {
			if (await handleApi(req, res, url)) return;
			if (vite) {
				vite.middlewares(req, res, () => {
					sendError(res, 404, "页面不存在");
				});
				return;
			}
			await serveStatic(res, url.pathname);
		} catch (error) {
			if (res.headersSent) {
				res.end();
				return;
			}
			if (error instanceof HttpError) {
				sendError(res, error.status, error.message);
				return;
			}
			const message = error instanceof Error ? error.message : "未知错误";
			if (!IS_PRODUCTION) console.error("[studio]", error);
			sendError(res, 500, IS_PRODUCTION ? "服务端处理失败" : message);
		}
	};
}

async function main(): Promise<void> {
	await fs.mkdir(POSTS_DIR, { recursive: true });

	let vite: ViteDevServer | null = null;
	if (!IS_PRODUCTION) {
		const { createServer: createViteServer } = await import("vite");
		vite = await createViteServer({
			configFile: path.join(STUDIO_DIR, "vite.config.ts"),
			root: STUDIO_DIR,
			appType: "spa",
			server: { middlewareMode: true },
		});
	} else if (!(await pathExists(path.join(DIST_DIR, "index.html")))) {
		throw new Error("未找到 studio/dist，请先执行 pnpm studio:build");
	}

	const handler = await createRequestHandler(vite);
	const server: Server = http.createServer((req, res) => {
		void handler(req, res);
	});

	await new Promise<void>((resolve) => {
		server.listen(PORT, HOST, resolve);
	});

	const shownHost = HOST === "0.0.0.0" ? getLanAddress() : HOST;
	console.log(`[studio] 写作后台已启动：http://${shownHost}:${PORT}`);
	console.log(
		`[studio] 文章目录：${path.relative(REPO_ROOT, POSTS_DIR)}　博客预览：${PREVIEW_ORIGIN}`,
	);
	if (IS_GENERATED_TOKEN) {
		console.log(
			`[studio] 本次运行口令（未配置 STUDIO_TOKEN，仅本次有效）：${TOKEN}`,
		);
	}
	if (HOST === "0.0.0.0") {
		console.log(
			"[studio] 已监听所有网卡，同网段设备可访问；该模式无 HTTPS，请勿暴露到公网",
		);
	}

	const shutdown = async (): Promise<void> => {
		await vite?.close();
		server.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

function getLanAddress(): string {
	const interfaces = networkInterfaces();
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) return entry.address;
		}
	}
	return "127.0.0.1";
}

main().catch((error: unknown) => {
	console.error("[studio] 启动失败：", error);
	process.exit(1);
});
