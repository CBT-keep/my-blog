/** 仅写作台前端内部使用的类型，与前后端契约 `@/types/studio` 分开。 */

/** 编辑区视图模式：纯所见即所得、分屏、纯预览。 */
export type EditorMode = "edit" | "split" | "preview";

export type ThemeName = "light" | "dark";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
