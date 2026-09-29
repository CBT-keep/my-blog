import type { FriendLink, FriendsPageConfig } from "../types/config";

export const friendsPageConfig: FriendsPageConfig = {
	title: "友链",
	description: "与朋友交换链接。",
	showComment: false,
	randomizeSort: false,
	applyLink: "",
	siteInfo: {
		name: "CBT-keep 的博客",
		desc: "记录代码、生活，以及一个人缓慢抵达自己的过程。",
		url: "http://localhost:4321",
		avatar: "/assets/images/home/character.webp",
		email: "",
	},
	notes: [],
	chat: [],
};

export const friendsConfig: FriendLink[] = [];

export const getEnabledFriends = (): FriendLink[] => {
	return friendsConfig.filter((friend) => friend.enabled);
};
