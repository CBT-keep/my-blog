import type { HomeConfig } from "../types/config";

export const homeConfig: HomeConfig = {
	// 头像
	// 图片路径支持三种格式：
	// 1. public 目录（以 "/" 开头，不优化）："/assets/images/avatar.webp"
	// 2. src 目录（不以 "/" 开头，自动优化但会增加构建时间，推荐）："assets/images/avatar.webp"
	// 3. 远程 URL："https://example.com/avatar.jpg"
	avatar: "assets/images/avatar.webp",

	// 名字
	name: "CBT-keep",

	// 首页展示名字（留空则使用 name）
	displayName: "CBT-keep",

	// 职业/身份标签
	occupation: "[软件工程在读 / 在抵达之前]",

	// 个人签名（支持多条，会循环打字+删除效果）
	bio: [
		"我是 CBT-keep。从福州出发，在成为自己的路上，慢慢走，也认真走。",
		"山不让尘，川不辞盈。",
		"莫听穿林打叶声，何妨吟啸且徐行。",
	],

	hero: {
		backgroundImage: "/assets/images/home/home.avif",
		mosaic: {
			rows: 4,
			columns: 6,
			idleVisible: 6,
			idleInterval: 900,
			seed: 20260814,
			// 首屏六块碎片按 reveal rank 放置；滚动或轮换后的随机布局不受影响。
			initialLayout: [
				{ x: 0.14, y: 0.305, width: 0.104, height: 0.205 },
				{ x: 0.435, y: 0.18, width: 0.068, height: 0.13, blur: 5.5 },
				{ x: 0.642, y: 0.368, width: 0.047, height: 0.092, blur: 5 },
				{ x: 0.863, y: 0.402, width: 0.097, height: 0.19 },
				{ x: 0.337, y: 0.653, width: 0.159, height: 0.313 },
				{ x: 0.639, y: 0.751, width: 0.116, height: 0.228 },
			],
			scrub: 0.45,
			// 滑动距离整体砍半，同样的滚动量推进更快
			desktopScrollDistance: 3250,
			mobileScrollDistance: 2300,
			desktopDialogueTailDistance: 240,
			mobileDialogueTailDistance: 180,
			desktopMinViewports: 4.05,
			mobileMinViewports: 3.05,
			interactionHold: 0.06,
		},
		contact: {
			platform: "GitHub",
			handle: "CBT-keep",
			href: "https://github.com/CBT-keep",
		},
		sticker: {
			image: "assets/images/avatar.webp",
			alt: "CBT-keep",
			eye: {
				xPercent: 37.5,
				yPercent: 53.5,
				travelXPercent: 1.4,
				travelYPercent: 1,
			},
			rightEye: {
				xPercent: 66.5,
				yPercent: 53.5,
			},
			mouth: {
				xPercent: 52,
				yPercent: 70.5,
				widthPercent: 7.2,
				heightPercent: 1.9,
				rotation: -6,
				travelScale: 0.45,
			},
		},
		// galgame 对话框（写死暗黑主题）。内容全部由此驱动，可自由增删
		dialogue: {
			enabled: true,
			speakers: {
				host: "CBT-keep",
				visitor: "访客",
			},
			menuTitle: "想聊点什么？",
			typingSpeed: 45,
			autoDelay: 1600,
			// 默认逐句播放的简介，末句后弹出话题菜单
			intro: [
				{ speaker: "host", text: "欢迎来坐。这里不是成功经验，更像一本还没写完的航行日志。" },
				{ speaker: "host", text: "我叫 CBT-keep。目前在福州上大学，软件工程在读，暂时还没有能拿出来吓人的履历。" },
				{
					speaker: "host",
					text: "不过没关系。很多人不是先从光里出发，而是先学会在夜里点灯。",
				},
				{ speaker: "host", text: "如果你也恰好站在起点，那我们可以一起往前走走。" },
			],
			// 话题菜单：点击进入逐句对话，末句后返回菜单
			topics: [
				{
					title: "先认识一下",
					lines: [
						{ speaker: "visitor", text: "你是一个怎样的人？" },
						{
							speaker: "host",
							text: "一个来自福州的普通学生。喜欢计算机，也喜欢把脑子里的世界想得很远。",
						},
						{ speaker: "visitor", text: "听起来有点理想主义。" },
						{
							speaker: "host",
							text: "是啊。可理想如果没有具体动作，就只是一朵漂亮的云。最近我在学的，就是让它一点点落地。",
						},
						{
							speaker: "host",
							text: "山不让尘，川不辞盈。今天多懂一点，明天就少慌一点。",
						},
					],
				},
				{
					title: "为什么记录",
					lines: [
						{ speaker: "visitor", text: "为什么要把这些写下来？" },
						{
							speaker: "host",
							text: "因为记忆会褪色，情绪偶尔也会撒谎。只有写下来的东西，能替我记住曾经走过哪里。",
						},
						{
							speaker: "host",
							text: "也许以后回头看，会发现当时觉得过不去的坎，不过是一段坡路。",
						},
						{
							speaker: "host",
							text: "岁月不居，时节如流。总得留下些什么，证明我们没有白走。",
						},
					],
				},
				{
					title: "想去的地方",
					lines: [
						{ speaker: "visitor", text: "你好像很想去杭州。" },
						{
							speaker: "host",
							text: "嗯。喜欢那里的水汽，也喜欢互联网行业还在生长的声音。",
						},
						{
							speaker: "host",
							text: "但比起“去到哪里”，我更在意自己到那时有没有变成一个更可靠的人。",
						},
						{ speaker: "host", text: "毕竟远方不是奖赏，它只是下一段路的起点。" },
					],
				},
				{
					title: "此刻相信的事",
					lines: [
						{ speaker: "visitor", text: "如果努力暂时没有回应呢？" },
						{
							speaker: "host",
							text: "那就把等待也当作生活的一部分。不是所有种子，都会在播种的第二天发芽。",
						},
						{ speaker: "host", text: "莫听穿林打叶声，何妨吟啸且徐行。" },
						{ speaker: "host", text: "慢一点没关系，别把自己弄丢就好。" },
					],
				},
			],
		},
		// 玻璃雨珠 + 撞击水花（移动端自动降低密度，尊重 prefers-reduced-motion）
		rain: {
			enabled: true,
			intensity: 0.6,
			// 留空则随主题自动取色（暗色→白 / 浅色→深灰）；也可填 "#7fb0ff" 或 "127,176,255"
			color: "#ffffff",
		},
	},

	dataLayer: {
		visitImage: "/assets/images/home-blinds/user/stage.webp",
		archiveImage: "/assets/images/home-blinds/user/lake-night.webp",
		contactImage: "/assets/images/home-blinds/user/sunset.webp",
	},

	// 桌面端双层影像交互：固定背景揭示 → 五幕画面横向叙事
	homeBlinds: {
		enabled: true,
		reveal: {
			backgroundImage: "/assets/images/home-blinds/act2/1.webp",
			foregroundImage: "/assets/images/home-blinds/act1/1.webp",
			foregroundAlt: "奔跑人物剪影",
			foregroundOpacity: 0.5,
			pointerTravel: 28,
			// 长条横移揭示的入场标题：标题单行显示（版式按 4 字排），
			// 祝福语单行显示（版式按 5 字排），可自由增减条数
			headline: {
				title: "欢迎来到",
				messages: ["慢慢新生", "向着远方", "写下此刻", "终会抵达"],
				enterDuration: 0.6,
				messageHold: 2.6,
				messageFlipDuration: 0.75,
			},
		},
		scenes: {
			scrollDistance: 3400,
			// 背景跑马灯：列表从右往左无缝循环，只有一张也会自动复制到铺满
			cycleImages: ["/assets/images/home-blinds/act-cycle/1.webp"],
			cycleDuration: 26,
			composite: {
				eyebrow: "PROLOGUE / DEPART",
				title: "从此刻出发",
				description: "把遥远写成路，把愿望写进今天。",
				alt: "暮色山峦",
				// 明信片右下角的落款日期，按每张图的实际日期改；删掉即不显示
				date: "2026 / 09 / 26",
			},
			items: [
				{
					eyebrow: "SCENE 02 / LIGHT",
					title: "写给未来",
					description: "你一定能成为你想要成为的人。",
					image: "/assets/images/home-blinds/user/stage.webp",
					alt: "舞台光束与文字",
					date: "2026 / 09 / 26",
				},
				{
					eyebrow: "SCENE 03 / NIGHT",
					title: "夜色有灯",
					description: "水面收住喧嚣，也替我留了一盏光。",
					image: "/assets/images/home-blinds/user/lake-night.webp",
					alt: "夜晚湖面与路灯",
					date: "2026 / 09 / 26",
				},
				{
					eyebrow: "SCENE 04 / LOCAL",
					title: "小鲸入海",
					description: "先让它在本地游起来，再驶向更远的服务器。",
					image: "/assets/images/home-blinds/user/deepseek-whale-girl.webp",
					alt: "DeepSeek 鲸娘",
					date: "2026 / 09 / 26",
				},
				{
					eyebrow: "FINALE / RETURN",
					title: "下一程山海",
					description: "故事没有结束，只是把这一页轻轻翻过。",
					image: "/assets/images/home-blinds/user/sunset.webp",
					alt: "暮色山峦",
					date: "2026 / 09 / 26",
				},
			],
			standImages: ["/assets/images/home-blinds/act4/1.webp"],
		},
	},

	// 链接配置
	// 已经预装的图标集：fa7-brands，fa7-regular，fa7-solid，material-symbols，simple-icons
	// 访问https://icones.js.org/ 获取图标代码，
	// 如果想使用尚未包含相应的图标集，则需要安装它
	// `pnpm add @iconify-json/<icon-set-name>`
	// showName: true 时显示图标和名称，false 时只显示图标
	links: [
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/CBT-keep",
			showName: false,
		},
		{
			name: "RSS",
			icon: "fa7-solid:rss",
			url: "/rss/",
			showName: false,
		},
	],
};
