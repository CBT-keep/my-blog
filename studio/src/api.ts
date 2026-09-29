import type {
	ApiError,
	CreatePostPayload,
	PostDocument,
	PostSummary,
	PublishResult,
	RenamePostPayload,
	SavePostPayload,
	SessionInfo,
	UploadResult,
} from "@/types/studio";

export class StudioError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "StudioError";
		this.status = status;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const headers = new Headers(init?.headers);
	if (init?.body !== undefined && !(init.body instanceof Blob)) {
		headers.set("content-type", "application/json");
	}
	const response = await fetch(path, { ...init, headers });
	if (!response.ok) {
		const payload = (await response
			.json()
			.catch(() => null)) as ApiError | null;
		throw new StudioError(
			payload?.error ?? `请求失败（${response.status}）`,
			response.status,
		);
	}
	return (await response.json()) as T;
}

export function getSession(): Promise<SessionInfo> {
	return request<SessionInfo>("/api/session");
}

export function login(token: string): Promise<{ ok: true }> {
	return request<{ ok: true }>("/api/login", {
		method: "POST",
		body: JSON.stringify({ token }),
	});
}

export function logout(): Promise<{ ok: true }> {
	return request<{ ok: true }>("/api/logout", { method: "POST" });
}

export function listPosts(): Promise<PostSummary[]> {
	return request<PostSummary[]>("/api/posts");
}

export function getPost(slug: string): Promise<PostDocument> {
	return request<PostDocument>(`/api/posts/${encodeURIComponent(slug)}`);
}

export function savePost(
	slug: string,
	payload: SavePostPayload,
): Promise<PostDocument> {
	return request<PostDocument>(`/api/posts/${encodeURIComponent(slug)}`, {
		method: "PUT",
		body: JSON.stringify(payload),
	});
}

export function createPost(payload: CreatePostPayload): Promise<PostDocument> {
	return request<PostDocument>("/api/posts", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export function renamePost(payload: RenamePostPayload): Promise<PostDocument> {
	return request<PostDocument>("/api/posts/rename", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export function deletePost(slug: string): Promise<{ ok: true }> {
	return request<{ ok: true }>(`/api/posts/${encodeURIComponent(slug)}`, {
		method: "DELETE",
	});
}

export function publishPosts(): Promise<PublishResult> {
	return request<PublishResult>("/api/publish", { method: "POST" });
}

/**
 * 上传走裸请求体而不是 multipart：编辑器一次只传一张图，
 * 服务端按文件头嗅探真实类型，不依赖表单里的 filename 字段。
 */
export function uploadImage(slug: string, file: File): Promise<UploadResult> {
	const query = new URLSearchParams({
		slug,
		name: file.name,
	});
	return request<UploadResult>(`/api/upload?${query.toString()}`, {
		method: "POST",
		body: file,
		headers: { "content-type": file.type || "application/octet-stream" },
	});
}
