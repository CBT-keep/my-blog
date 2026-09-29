/**
 * 中英文混排的字数估算。
 *
 * 写作台的服务端（列表页统计）与前端（顶栏实时统计）共用这一份实现，
 * 否则同一篇文章在两处会显示不同的字数。
 *
 * 口径：CJK 逐字计，拉丁字母与数字按词计；代码块、行内代码、链接地址、
 * HTML 标签与 Markdown 标记符号都不计入。
 */
export function countWords(markdown: string): number {
	const text = markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/~~~[\s\S]*?~~~/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/^\s{0,3}#{1,6}\s+/gm, " ")
		.replace(/^\s{0,3}>\s?/gm, " ")
		.replace(/[*_~#|-]/g, "");

	const cjk =
		text.match(
			/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
		)?.length ?? 0;
	const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
	return cjk + latin;
}
