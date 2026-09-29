# CBT-keep 的博客

基于 [Firefly-Mod](https://github.com/MmzMing/my-blog) 整理的个人博客本地基线，上游继续追溯到 [Firefly](https://github.com/CuteLeaf/Firefly) 与 [Fuwari](https://github.com/saicaca/fuwari)。

## 当前状态

- 作者文章、相册、音乐、Live2D、友链与个人资料已清理
- 头像与站点图标已替换
- 首页吉祥物已替换为提供的鲸娘素材
- 评论、留言、打赏和音乐入口未启用
- 文章集合为空，列表页和归档页可正常显示空状态

## 环境要求

- Node.js >= 22
- pnpm >= 11

## 本地开发

```bash
pnpm install
pnpm dev
```

开发服务器默认地址：`http://localhost:4321`

## 常用命令

```bash
pnpm check
pnpm build
pnpm preview
pnpm format
pnpm lint
```

## 主要配置

- `src/config/siteConfig.ts`：站点名称、域名、描述、页面开关与统计
- `src/config/homeConfig.ts`：头像、首页文案、角色对话与吉祥物
- `src/config/navBarConfig.ts`：导航栏
- `src/config/footerConfig.ts`：页脚与备案信息
- `src/config/commentConfig.ts`：评论服务，当前为 `none`
- `src/content/spec/about.mdx`：关于页内容

## 发布

`pnpm build` 会先处理图标与图片占位，再生成 Astro 静态站点和 Pagefind 索引，最终产物位于 `dist/`，可直接部署到 Nginx、Vercel、Cloudflare Pages 或 Netlify。

## 许可

代码沿用上游 MIT 许可。第三方角色素材、字体、音视频和个人图片的使用需分别确认授权。
