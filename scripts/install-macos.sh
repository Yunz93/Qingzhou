#!/usr/bin/env bash
# 轻舟 / Qingzhou one-click installer for macOS.
# Official install path: download the GitHub Release, copy into Applications,
# then apply local trust (quarantine + ad-hoc codesign + optional spctl).
# There is no Apple Developer ID / notarization; do not double-click the DMG.
#
# Usage:
#   curl -fsSL https://github.com/Yunz93/Qingzhou/releases/latest/download/install-macos.sh | bash
#   ./scripts/install-macos.sh
#   ./scripts/install-macos.sh /path/to/Qingzhou.dmg
#   ./scripts/install-macos.sh --build
#   ./scripts/install-macos.sh --trust-only /Applications/Qingzhou.app

set -euo pipefail

APP_NAME="Qingzhou"
REPO="${QINGZHOU_REPO:-${MOWEN_REPO:-${OHMYPI_REPO:-Yunz93/Qingzhou}}}"
DEST_DIR="/Applications"
BUILD=0
LOCAL=0
TRUST_ONLY=0
OPEN_AFTER=1
SOURCE=""
VERSION="${QINGZHOU_VERSION:-${MOWEN_VERSION:-latest}}"

die() {
  echo "错误: $*" >&2
  exit 1
}

info() {
  echo "→ $*" >&2
}

ok() {
  echo "✓ $*" >&2
}

# Avoid empty-array expansion: macOS /bin/bash (3.2) with `set -u` treats
# an empty curl header array as unbound. Pass optional auth via a helper.
curl_github() {
  local token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [[ -n "$token" ]]; then
    curl -fL --retry 3 --retry-delay 2 -S -H "Authorization: Bearer ${token}" "$@"
  else
    curl -fL --retry 3 --retry-delay 2 -S "$@"
  fi
}

need_darwin() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "这个脚本只能在 macOS 上运行。"
  fi
}

mac_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo "arm64" ;;
    x86_64) echo "x64" ;;
    *) die "不支持的芯片架构: $(uname -m)" ;;
  esac
}

usage() {
  cat <<EOF
轻舟 macOS 一键安装（官方方式：从 GitHub Release 下载并在本机完成信任）

没有 Apple 公证。请用这个脚本，不要双击 .dmg。

用法:
  curl -fsSL https://github.com/${REPO}/releases/latest/download/install-macos.sh | bash
  $0 [选项] [Qingzhou.app|Qingzhou.dmg|Qingzhou.zip]

选项:
  --version VER   安装指定版本（例如 v0.1.0）
  --repo OWNER/NAME
  --local         使用仓库里 apps/desktop/release 的包
  --build         本机执行 pnpm desktop:pack:mac 再安装
  --trust-only    只对已有 .app 做系统信任（不下载）
  --user          安装到 ~/Applications（不需要管理员）
  --no-open       安装后不自动打开
  -h, --help      显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=1; shift ;;
    --local) LOCAL=1; shift ;;
    --version) VERSION="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --trust-only) TRUST_ONLY=1; shift ;;
    --user) DEST_DIR="${HOME}/Applications"; shift ;;
    --no-open) OPEN_AFTER=0; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*) die "未知选项: $1" ;;
    *) SOURCE="$1"; shift ;;
  esac
done

[[ "$VERSION" == "latest" || "$VERSION" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版本必须是 latest 或正式版本号（例如 v0.1.21）。"

# In-app updates launch this script detached, then quit the running Electron
# process. Wait for it to disappear before replacing the application bundle.
UPDATE_PARENT_PID="${QINGZHOU_UPDATE_PARENT_PID:-${MOWEN_UPDATE_PARENT_PID:-}}"
if [[ -n "${UPDATE_PARENT_PID}" && "${UPDATE_PARENT_PID}" =~ ^[0-9]+$ ]]; then
  while kill -0 "${UPDATE_PARENT_PID}" 2>/dev/null; do sleep 0.2; done
fi

ROOT=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
RELEASE_DIR="${ROOT:+$ROOT/apps/desktop/release}"
TMP_DIR=""
ATTACHED_DMG=""

cleanup() {
  if [[ -n "${ATTACHED_DMG}" ]]; then
    hdiutil detach "${ATTACHED_DMG}" -quiet >/dev/null 2>&1 || true
    ATTACHED_DMG=""
  fi
  if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

ensure_tmp_dir() {
  if [[ -z "${TMP_DIR}" ]]; then
    TMP_DIR="$(mktemp -d -t qingzhou-install)"
  fi
}

find_app_in_dir() {
  local dir="$1"
  local found
  found="$(find "$dir" -maxdepth 5 \( -name "${APP_NAME}.app" -o -name "Mowen.app" -o -name "ohMyPi.app" -o -name "MyPi.app" \) -type d 2>/dev/null | head -n 1 || true)"
  if [[ -z "$found" ]]; then
    found="$(find "$dir" -maxdepth 5 -name "*.app" -type d 2>/dev/null | head -n 1 || true)"
  fi
  echo "$found"
}

# hdiutil prints: /dev/disk4s1  Apple_HFS  /Volumes/Qingzhou 0.1.0
# awk $NF would be "0.1.0" because the volume name has a space.
parse_hdiutil_mount() {
  sed -n 's/.*\(\/Volumes\/.*\)$/\1/p' | tail -n 1
}

mount_dmg() {
  local dmg="$1"
  local mountpoint output
  ensure_tmp_dir
  mountpoint="${TMP_DIR}/volume"
  mkdir -p "$mountpoint"
  if hdiutil attach "$dmg" -nobrowse -readonly -noverify -mountpoint "$mountpoint" >/dev/null 2>&1; then
    ATTACHED_DMG="$mountpoint"
    echo "$mountpoint"
    return
  fi
  output="$(hdiutil attach "$dmg" -nobrowse -readonly -noverify 2>&1)" || die "无法打开磁盘映像: $dmg"
  ATTACHED_DMG="$(printf '%s\n' "$output" | parse_hdiutil_mount)"
  [[ -n "${ATTACHED_DMG}" ]] || die "挂载 DMG 失败。"
  echo "${ATTACHED_DMG}"
}

unpack_source() {
  local input="${1:-}"
  [[ -n "$input" ]] || die "没有提供安装包路径。"
  if [[ -d "$input" && "$input" == *.app ]]; then
    echo "$input"
    return
  fi
  if [[ -f "$input" && "$input" == *.dmg ]]; then
    local volume app
    volume="$(mount_dmg "$input")"
    app="$(find_app_in_dir "$volume")"
    if [[ -z "$app" ]]; then
      die "DMG 里没有找到 ${APP_NAME}.app（已挂载: ${volume}）
$(ls -la "$volume" 2>/dev/null || true)"
    fi
    echo "$app"
    return
  fi
  if [[ -f "$input" && "$input" == *.zip ]]; then
    local unzip_dir app
    ensure_tmp_dir
    unzip_dir="${TMP_DIR}/unpacked"
    mkdir -p "$unzip_dir"
    unzip -q "$input" -d "$unzip_dir" || die "解压失败: ${input}"
    app="$(find_app_in_dir "$unzip_dir")"
    [[ -n "$app" ]] || die "ZIP 里没有找到 ${APP_NAME}.app"
    echo "$app"
    return
  fi
  die "不支持的安装包: ${input} (需要 .app / .dmg / .zip)"
}

locate_packaged_app() {
  [[ -n "${RELEASE_DIR}" && -d "${RELEASE_DIR}" ]] || { echo ""; return; }
  local app dmg zip
  app="$(find_app_in_dir "$RELEASE_DIR")"
  if [[ -n "$app" ]]; then echo "$app"; return; fi
  dmg="$(find "$RELEASE_DIR" -maxdepth 3 -name "*.dmg" -type f 2>/dev/null | head -n 1 || true)"
  if [[ -n "$dmg" ]]; then unpack_source "$dmg"; return; fi
  zip="$(find "$RELEASE_DIR" -maxdepth 3 -name "*.zip" -type f 2>/dev/null | head -n 1 || true)"
  if [[ -n "$zip" ]]; then unpack_source "$zip"; return; fi
  echo ""
}

maybe_build() {
  [[ "$BUILD" == "1" ]] || return 0
  [[ -n "$ROOT" ]] || die "--build 需要在 git 仓库里运行，不能用 curl | bash。"
  command -v pnpm >/dev/null || die "未找到 pnpm。请先安装 Node.js 22+ 并执行 corepack enable。"
  info "正在打包 macOS 应用（首次会下载 Pi，可能较久）…"
  (cd "$ROOT" && pnpm desktop:pack:mac) || die "打包失败。"
}

download_release() {
  local arch="$1"
  TMP_DIR="$(mktemp -d -t qingzhou-install)"
  local tag="$VERSION"
  local base
  if [[ "$tag" == "latest" ]]; then
    base="https://github.com/${REPO}/releases/latest/download"
  else
    [[ "$tag" == v* ]] || tag="v${tag}"
    base="https://github.com/${REPO}/releases/download/${tag}"
  fi

  local names=(
    "Qingzhou-mac-${arch}.zip"
    "Qingzhou-mac-${arch}.dmg"
    "Mowen-mac-${arch}.zip"
    "Mowen-mac-${arch}.dmg"
    "ohMyPi-mac-${arch}.zip"
    "ohMyPi-mac-${arch}.dmg"
    "MyPi-mac-${arch}.zip"
    "MyPi-mac-${arch}.dmg"
  )
  local out="" name
  info "正在从 GitHub 下载 ${APP_NAME} (${arch}, ${tag})…"
  download_checksums "$base"
  for name in "${names[@]}"; do
    out="${TMP_DIR}/${name}"
    info "GET ${base}/${name}"
    if curl_github -o "$out" "${base}/${name}"; then
      verify_release_file "$out" || { rm -f "$out"; continue; }
      ok "已下载 $name"
      echo "$out"
      return
    fi
    rm -f "$out"
  done
  die "下载失败。请确认仓库 ${REPO} 已有 Release 资源 ${names[0]}（Intel 需要 x64，Apple 芯片需要 arm64）。也可改用 --build 在本机打包。"
}

download_checksums() {
  local base="$1"
  local sums="${TMP_DIR}/SHA256SUMS.txt"
  info "GET ${base}/SHA256SUMS.txt"
  if curl_github -o "$sums" "${base}/SHA256SUMS.txt"; then
    ok "已下载校验清单"
    return 0
  fi
  rm -f "$sums"
  echo "警告: 这个版本没有 SHA256SUMS.txt，跳过完整性校验。" >&2
}

# SHA256SUMS.txt from `sha256sum dist/*` lists `dist/Qingzhou-mac-arm64.zip`.
# Compare the basename so those lines still match the downloaded file.
checksum_for_name() {
  local sums="$1"
  local want="$2"
  awk -v name="$want" '
    {
      f = $2
      sub(/^\*/, "", f)
      n = split(f, parts, "/")
      if (parts[n] == name) { print $1; exit }
    }
  ' "$sums"
}

verify_release_file() {
  local file="$1"
  local name sums expected actual
  name="$(basename "$file")"
  sums="${TMP_DIR}/SHA256SUMS.txt"
  [[ -f "$sums" ]] || return 0
  expected="$(checksum_for_name "$sums" "$name")"
  if [[ -z "$expected" ]]; then
    # Brace ${name}: macOS /bin/bash 3.2 + set -u treats $name plus a fullwidth comma as one identifier.
    echo "警告: 校验清单里没有 ${name}，跳过。" >&2
    return 0
  fi
  if command -v shasum >/dev/null; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  else
    actual="$(sha256sum "$file" | awk '{print $1}')"
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "错误: ${name} 校验和不匹配。" >&2
    return 1
  fi
  ok "${name} 校验通过"
}

trust_app() {
  local app="$1"
  [[ -d "$app" ]] || die "找不到应用: $app"

  info "清除隔离属性（quarantine）…"
  xattr -cr "$app" 2>/dev/null || true
  xattr -dr com.apple.quarantine "$app" 2>/dev/null || true
  if command -v sudo >/dev/null && sudo -n true 2>/dev/null; then
    sudo xattr -cr "$app" 2>/dev/null || true
    sudo xattr -dr com.apple.quarantine "$app" 2>/dev/null || true
  fi

  if command -v codesign >/dev/null; then
    info "写入本机 ad-hoc 签名…"
    codesign --force --deep --sign - --timestamp=none "$app" 2>/dev/null \
      || sudo codesign --force --deep --sign - --timestamp=none "$app" \
      || die "codesign 失败。"
    if codesign --verify --deep --strict "$app" >/dev/null 2>&1; then
      ok "签名校验通过。"
    else
      codesign --verify --deep "$app" >/dev/null 2>&1 && ok "签名已写入（非 strict）。" \
        || echo "警告: codesign --verify 未完全通过，仍可尝试打开。" >&2
    fi
  else
    echo "警告: 没有 codesign，已跳过签名。" >&2
  fi

  if command -v spctl >/dev/null; then
    info "登记 Gatekeeper 评估…"
    if sudo -n true 2>/dev/null || [[ -t 0 ]]; then
      sudo spctl --add --label "${APP_NAME}" "$app" 2>/dev/null \
        && sudo spctl --enable --label "${APP_NAME}" 2>/dev/null \
        && ok "已加入 spctl 白名单。" \
        || echo "提示: spctl 登记失败（新系统上较常见），隔离属性已清除，一般仍可打开。" >&2
    else
      echo "提示: 当前无法使用 sudo，已跳过 spctl。若打开仍被拦截，请用管理员再跑一次。" >&2
    fi
  fi

  local lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  if [[ -x "$lsregister" ]]; then
    "$lsregister" -f "$app" >/dev/null 2>&1 || true
  fi

  ok "已完成 macOS 信任处理: $app"
}

copy_app() {
  local src="${1:-}"
  local dest="${DEST_DIR}/${APP_NAME}.app"
  local legacy_mowen="${DEST_DIR}/Mowen.app"
  local legacy_ohmypi="${DEST_DIR}/ohMyPi.app"
  local legacy="${DEST_DIR}/MyPi.app"
  [[ -d "$src" ]] || die "找不到要安装的应用: ${src:-<empty>}"
  mkdir -p "$DEST_DIR" || die "无法创建目录: $DEST_DIR"
  if [[ -d "$dest" ]]; then
    info "正在替换已有安装: $dest"
    rm -rf "$dest" 2>/dev/null || sudo rm -rf "$dest" || die "无法删除旧版本。"
  fi
  if [[ "$dest" != "$legacy_mowen" && -d "$legacy_mowen" ]]; then
    info "正在移除旧版 Mowen.app"
    rm -rf "$legacy_mowen" 2>/dev/null || sudo rm -rf "$legacy_mowen" || true
  fi
  if [[ "$dest" != "$legacy_ohmypi" && -d "$legacy_ohmypi" ]]; then
    info "正在移除旧版 ohMyPi.app"
    rm -rf "$legacy_ohmypi" 2>/dev/null || sudo rm -rf "$legacy_ohmypi" || true
  fi
  if [[ "$dest" != "$legacy" && -d "$legacy" ]]; then
    info "正在移除旧版 MyPi.app"
    rm -rf "$legacy" 2>/dev/null || sudo rm -rf "$legacy" || true
  fi
  info "安装到 $dest"
  if cp -R "$src" "$dest" 2>/dev/null; then
    :
  else
    sudo cp -R "$src" "$dest" || die "拷贝失败（可能需要管理员密码）。"
  fi
  if [[ "$(stat -f %u "$dest" 2>/dev/null || echo 0)" == "0" ]]; then
    sudo chown -R "$(id -un):staff" "$dest" 2>/dev/null || true
  fi
  echo "$dest"
}

if [[ "${QINGZHOU_SELF_TEST:-${MOWEN_SELF_TEST:-${OHMYPI_SELF_TEST:-}}}" == "1" ]]; then
  GITHUB_TOKEN=""
  GH_TOKEN=""
  curl_github --version >/dev/null
  if ( unpack_source "" ) 2>/dev/null; then
    die "unpack_source should reject an empty path"
  fi
  if ( copy_app "" ) 2>/dev/null; then
    die "copy_app should reject an empty path"
  fi
  parsed="$(printf '%s\n' '/dev/disk4s1        	Apple_HFS                      	/Volumes/Qingzhou 0.1.0' | parse_hdiutil_mount)"
  if [[ "$parsed" != "/Volumes/Qingzhou 0.1.0" ]]; then
    die "parse_hdiutil_mount should keep spaces in the volume path, got: ${parsed}"
  fi
  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qingzhou-self-test.XXXXXX")"
  printf '%s\n' 'ok' > "${TMP_DIR}/payload.txt"
  if command -v shasum >/dev/null; then
    good="$(shasum -a 256 "${TMP_DIR}/payload.txt" | awk '{print $1}')"
  else
    good="$(sha256sum "${TMP_DIR}/payload.txt" | awk '{print $1}')"
  fi
  printf '%s  payload.txt\n' "$good" > "${TMP_DIR}/SHA256SUMS.txt"
  if ! verify_release_file "${TMP_DIR}/payload.txt"; then
    die "verify_release_file should accept a matching checksum"
  fi
  printf '%s  dist/payload.txt\n' "$good" > "${TMP_DIR}/SHA256SUMS.txt"
  if ! verify_release_file "${TMP_DIR}/payload.txt"; then
    die "verify_release_file should match SHA256SUMS paths under dist/"
  fi
  printf '%s  other.txt\n' "$good" > "${TMP_DIR}/SHA256SUMS.txt"
  if ! verify_release_file "${TMP_DIR}/payload.txt"; then
    die "verify_release_file should skip when the checksum name is missing"
  fi
  printf '%s  payload.txt\n' "0000000000000000000000000000000000000000000000000000000000000000" > "${TMP_DIR}/SHA256SUMS.txt"
  if verify_release_file "${TMP_DIR}/payload.txt"; then
    die "verify_release_file should reject a mismatched checksum"
  fi
  rm -rf "${TMP_DIR}"
  ok "self-test passed"
  echo "self-test passed"
  exit 0
fi

need_darwin

if [[ "$TRUST_ONLY" == "1" ]]; then
  TARGET="${SOURCE:-${DEST_DIR}/${APP_NAME}.app}"
  [[ -d "$TARGET" ]] || die "--trust-only 需要一个 .app 路径。"
  trust_app "$TARGET"
  exit 0
fi

APP_SRC=""
if [[ -n "$SOURCE" ]]; then
  APP_SRC="$(unpack_source "$SOURCE")"
elif [[ "$BUILD" == "1" ]]; then
  maybe_build
  APP_SRC="$(locate_packaged_app)"
  [[ -n "$APP_SRC" ]] || die "打包后仍未找到 ${APP_NAME}.app。请检查 apps/desktop/release。"
elif [[ "$LOCAL" == "1" ]]; then
  APP_SRC="$(locate_packaged_app)"
  [[ -n "$APP_SRC" ]] || die "本地没有安装包。请先 pnpm desktop:pack:mac，或去掉 --local 从 GitHub 下载。"
else
  PACKAGE="$(download_release "$(mac_arch)")"
  [[ -n "${PACKAGE}" && -f "${PACKAGE}" ]] || die "下载失败。"
  APP_SRC="$(unpack_source "${PACKAGE}")"
fi

[[ -n "${APP_SRC}" && -d "${APP_SRC}" ]] || die "找不到 ${APP_NAME}.app（得到: '${APP_SRC:-}'）。"
INSTALLED="$(copy_app "$APP_SRC")"
[[ -n "${INSTALLED}" && -d "${INSTALLED}" ]] || die "安装失败。"
trust_app "$INSTALLED"

if [[ "$OPEN_AFTER" == "1" ]]; then
  info "正在打开 ${APP_NAME}…"
  open "$INSTALLED"
fi

echo
ok "安装完成。请按屏幕上的向导粘贴 API Key 并选择工作文件夹。"
echo "   应用位置: $INSTALLED"
echo "   若仍提示无法打开: 系统设置 → 隐私与安全性 → 仍要打开"
echo "   或再执行: bash <(curl -fsSL https://github.com/${REPO}/releases/latest/download/install-macos.sh) --trust-only \"$INSTALLED\""
