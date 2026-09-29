#!/usr/bin/env bash
#
# Pull the latest blog build from a GitHub release and atomically replace dist.
# This runs on the Aliyun server so the ECS never has to run Astro/Vite builds.

set -euo pipefail

BLOG_REPO="${BLOG_REPO:-CBT-keep/my-blog}"
BLOG_RELEASE="${BLOG_RELEASE:-blog-latest}"
BLOG_DEPLOY_DIR="${BLOG_DEPLOY_DIR:-/opt/blog/dist}"
BLOG_STATE_DIR="${BLOG_STATE_DIR:-/var/lib/blog-deploy}"
BLOG_ASSET_NAME="${BLOG_ASSET_NAME:-blog-dist.tar.gz}"
BLOG_NGINX_SERVICE="${BLOG_NGINX_SERVICE:-nginx}"
BLOG_DOWNLOAD_BASE="${BLOG_DOWNLOAD_BASE:-https://gh-proxy.com/}"

state_file="${BLOG_STATE_DIR}/release"
temp_dir="${BLOG_STATE_DIR}/tmp"
next_dir="${BLOG_DEPLOY_DIR}.next"
previous_dir="${BLOG_DEPLOY_DIR}.previous"
release_url="https://api.github.com/repos/${BLOG_REPO}/releases/tags/${BLOG_RELEASE}"

mkdir -p "$BLOG_STATE_DIR"
rm -rf "$temp_dir" "$next_dir" "$previous_dir"
mkdir -p "$temp_dir" "$next_dir"

http_status="$(
	curl -sSL --retry 3 --connect-timeout 15 \
		-o "$temp_dir/release.json" \
		-w "%{http_code}" \
		"$release_url"
)"

if [[ "$http_status" == "404" ]]; then
	exit 0
fi
if [[ "$http_status" != "200" ]]; then
	echo "GitHub release request failed with HTTP $http_status" >&2
	exit 1
fi

asset_url="$(
	node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const asset = data.assets.find((item) => item.name === process.argv[2]);
if (!asset || !asset.browser_download_url) process.exit(1);
process.stdout.write(asset.browser_download_url);
' "$temp_dir/release.json" "$BLOG_ASSET_NAME"
)"

fingerprint="$(
	node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const asset = data.assets.find((item) => item.name === process.argv[2]);
if (!asset) process.exit(1);
process.stdout.write(String(asset.id) + ":" + asset.updated_at);
' "$temp_dir/release.json" "$BLOG_ASSET_NAME"
)"

if [[ -f "$state_file" && "$(cat "$state_file")" == "$fingerprint" ]]; then
	exit 0
fi

downloaded=0
for download_url in "${BLOG_DOWNLOAD_BASE}${asset_url}" "$asset_url"; do
	if curl -fsSL --http1.1 --retry 3 --retry-all-errors \
		--connect-timeout 15 --max-time 180 -A "Mozilla/5.0" \
		-o "$temp_dir/$BLOG_ASSET_NAME" \
		"$download_url"; then
		downloaded=1
		break
	fi
done

if [[ "$downloaded" != "1" ]]; then
	echo "failed to download $BLOG_ASSET_NAME" >&2
	exit 1
fi

tar -tzf "$temp_dir/$BLOG_ASSET_NAME" >"$temp_dir/files.txt"
if ! grep -qx "./index.html" "$temp_dir/files.txt"; then
	echo "release asset does not contain ./index.html" >&2
	exit 1
fi

tar -xzf "$temp_dir/$BLOG_ASSET_NAME" -C "$next_dir"

if [[ -d "$BLOG_DEPLOY_DIR" ]]; then
	mv "$BLOG_DEPLOY_DIR" "$previous_dir"
fi
mv "$next_dir" "$BLOG_DEPLOY_DIR"

if ! systemctl reload "$BLOG_NGINX_SERVICE"; then
	rm -rf "$BLOG_DEPLOY_DIR"
	if [[ -d "$previous_dir" ]]; then
		mv "$previous_dir" "$BLOG_DEPLOY_DIR"
	fi
	exit 1
fi

rm -rf "$previous_dir" "$temp_dir"
printf '%s\n' "$fingerprint" >"$state_file"
