#!/usr/bin/env bash
set -euo pipefail

# EasyVault Desktop Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/NiclasAssendelft/EasyVault-desktop/main/install.sh | bash

REPO="NiclasAssendelft/EasyVault-desktop"
APP_NAME="EasyVault"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║       EasyVault Desktop Installer     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64) PLATFORM="macos-arm64" ;;
      x86_64) PLATFORM="macos-intel" ;;
      *) echo "❌ Unsupported macOS architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  Linux)
    PLATFORM="linux"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "❌ Windows detected. Please download the .msi installer from:"
    echo "   https://github.com/$REPO/releases/latest"
    echo ""
    echo "   Or run this in PowerShell:"
    echo '   irm https://raw.githubusercontent.com/'"$REPO"'/main/install.ps1 | iex'
    exit 1
    ;;
  *)
    echo "❌ Unsupported OS: $OS"
    exit 1
    ;;
esac

echo "🔍 Detected: $OS ($ARCH) → $PLATFORM"
echo "📡 Fetching latest release..."

# Get latest release info from GitHub API
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
TAG=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*: "//;s/".*//')

if [ -z "$TAG" ]; then
  echo "❌ Could not find latest release. Check: https://github.com/$REPO/releases"
  exit 1
fi

echo "📦 Latest version: $TAG"

# Find the right asset URL based on platform
find_asset_url() {
  local pattern="$1"
  echo "$RELEASE_JSON" | grep '"browser_download_url"' | grep -i "$pattern" | head -1 | sed 's/.*: "//;s/".*//'
}

case "$PLATFORM" in
  macos-arm64)
    DOWNLOAD_URL=$(find_asset_url "aarch64.*\.dmg")
    if [ -z "$DOWNLOAD_URL" ]; then
      DOWNLOAD_URL=$(find_asset_url "universal.*\.dmg\|\.dmg")
    fi
    FILENAME="EasyVault.dmg"
    ;;
  macos-intel)
    DOWNLOAD_URL=$(find_asset_url "x86_64.*\.dmg")
    if [ -z "$DOWNLOAD_URL" ]; then
      DOWNLOAD_URL=$(find_asset_url "universal.*\.dmg\|\.dmg")
    fi
    FILENAME="EasyVault.dmg"
    ;;
  linux)
    # Prefer AppImage, fall back to .deb
    DOWNLOAD_URL=$(find_asset_url "\.AppImage")
    if [ -n "$DOWNLOAD_URL" ]; then
      FILENAME="EasyVault.AppImage"
    else
      DOWNLOAD_URL=$(find_asset_url "\.deb")
      FILENAME="EasyVault.deb"
    fi
    ;;
esac

if [ -z "$DOWNLOAD_URL" ]; then
  echo "❌ Could not find installer for $PLATFORM"
  echo "   Check available downloads: https://github.com/$REPO/releases/latest"
  exit 1
fi

TMPDIR="${TMPDIR:-/tmp}"
DOWNLOAD_PATH="$TMPDIR/$FILENAME"

echo "⬇️  Downloading $FILENAME..."
curl -fSL --progress-bar "$DOWNLOAD_URL" -o "$DOWNLOAD_PATH"

echo "📥 Downloaded to: $DOWNLOAD_PATH"

# Install based on platform
case "$PLATFORM" in
  macos-arm64|macos-intel)
    echo "📂 Mounting DMG..."
    MOUNT_POINT=$(hdiutil attach "$DOWNLOAD_PATH" -nobrowse -quiet | tail -1 | awk '{print $NF}')

    if [ -d "$MOUNT_POINT/$APP_NAME.app" ]; then
      echo "🚀 Installing to /Applications..."
      # Remove old version if exists
      if [ -d "/Applications/$APP_NAME.app" ]; then
        rm -rf "/Applications/$APP_NAME.app"
      fi
      cp -R "$MOUNT_POINT/$APP_NAME.app" /Applications/
      hdiutil detach "$MOUNT_POINT" -quiet
      rm -f "$DOWNLOAD_PATH"
      echo ""
      echo "✅ $APP_NAME installed to /Applications!"
      echo "   Open it from Spotlight or run: open /Applications/$APP_NAME.app"
      echo ""
      echo "⚠️  First launch: macOS may show a security warning."
      echo "   Right-click the app → Open → Open to bypass Gatekeeper."
    else
      hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
      echo "❌ Could not find $APP_NAME.app in DMG"
      exit 1
    fi
    ;;
  linux)
    if [[ "$FILENAME" == *.AppImage ]]; then
      INSTALL_DIR="$HOME/.local/bin"
      mkdir -p "$INSTALL_DIR"
      mv "$DOWNLOAD_PATH" "$INSTALL_DIR/EasyVault.AppImage"
      chmod +x "$INSTALL_DIR/EasyVault.AppImage"
      echo ""
      echo "✅ $APP_NAME installed to $INSTALL_DIR/EasyVault.AppImage"
      echo "   Run it with: EasyVault.AppImage"
      echo "   (Make sure ~/.local/bin is in your PATH)"
    elif [[ "$FILENAME" == *.deb ]]; then
      echo "🔧 Installing .deb package (may ask for sudo password)..."
      sudo dpkg -i "$DOWNLOAD_PATH" || sudo apt-get install -f -y
      rm -f "$DOWNLOAD_PATH"
      echo ""
      echo "✅ $APP_NAME installed!"
      echo "   Run it from your application menu or: easyvault"
    fi
    ;;
esac

echo ""
echo "🎉 Done! Enjoy EasyVault."
