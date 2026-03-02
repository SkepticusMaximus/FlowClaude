#!/data/data/com.termux/files/usr/bin/bash
# FlowClaude Bootstrap Installer
# Installs Claude Code in Termux with proot /tmp fix and termux-api support.

set -e  # Exit immediately if any command fails

echo ""
echo "=============================="
echo "  FlowClaude Installer"
echo "=============================="
echo ""

# ── Step 1: Update package lists ──────────────────────────────────────────────
echo "[1/6] Updating Termux packages..."
pkg update -y && pkg upgrade -y

# ── Step 2: Install required packages ─────────────────────────────────────────
echo ""
echo "[2/6] Installing dependencies (nodejs, git, proot, termux-api)..."
pkg install -y nodejs git proot termux-api

# ── Step 3: Install Claude Code via npm ───────────────────────────────────────
echo ""
echo "[3/6] Installing Claude Code..."
npm install -g @anthropic-ai/claude-code

# ── Step 4: Configure .bashrc ─────────────────────────────────────────────────
echo ""
echo "[4/6] Configuring .bashrc..."

BASHRC="$HOME/.bashrc"
PROOT_LINE='proot -b $TMPDIR:/tmp claude'

if grep -qF "$PROOT_LINE" "$BASHRC" 2>/dev/null; then
    echo "  .bashrc already configured, skipping."
else
    echo "" >> "$BASHRC"
    echo "# FlowClaude: launch Claude Code with /tmp fix" >> "$BASHRC"
    echo "$PROOT_LINE" >> "$BASHRC"
    echo "  .bashrc updated."
fi

# ── Step 5: Enable external app access (required for FlowClaude APK) ──────────
echo ""
echo "[5/6] Enabling external app access..."

TERMUX_PROPS="$HOME/.termux/termux.properties"
mkdir -p "$HOME/.termux"

if grep -qF "allow-external-apps=true" "$TERMUX_PROPS" 2>/dev/null; then
    echo "  already enabled, skipping."
else
    echo "allow-external-apps=true" >> "$TERMUX_PROPS"
    echo "  enabled."
fi

# Reload Termux settings to apply the change
termux-reload-settings 2>/dev/null || true

# ── Step 6: Done ──────────────────────────────────────────────────────────────
echo ""
echo "[6/6] All done!"
echo ""
echo "=============================="
echo "  Installation complete."
echo ""
echo "  IMPORTANT: You also need the"
echo "  Termux:API companion app from"
echo "  F-Droid (not the Play Store)."
echo ""
echo "  To start Claude Code, open a"
echo "  new Termux session or run:"
echo "    proot -b \$TMPDIR:/tmp claude"
echo "=============================="
echo ""
