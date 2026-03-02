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
echo "[1/5] Updating Termux packages..."
pkg update -y && pkg upgrade -y

# ── Step 2: Install required packages ─────────────────────────────────────────
echo ""
echo "[2/5] Installing dependencies (nodejs, git, proot, termux-api)..."
pkg install -y nodejs git proot termux-api

# ── Step 3: Install Claude Code via npm ───────────────────────────────────────
echo ""
echo "[3/5] Installing Claude Code..."
npm install -g @anthropic-ai/claude-code

# ── Step 4: Configure .bashrc ─────────────────────────────────────────────────
echo ""
echo "[4/5] Configuring .bashrc..."

BASHRC="$HOME/.bashrc"
PROOT_LINE='proot -b $TMPDIR:/tmp claude'

# Only add the line if it isn't already there
if grep -qF "$PROOT_LINE" "$BASHRC" 2>/dev/null; then
    echo "  .bashrc already configured, skipping."
else
    echo "" >> "$BASHRC"
    echo "# FlowClaude: launch Claude Code with /tmp fix" >> "$BASHRC"
    echo "$PROOT_LINE" >> "$BASHRC"
    echo "  .bashrc updated."
fi

# ── Step 5: Done ──────────────────────────────────────────────────────────────
echo ""
echo "[5/5] All done!"
echo ""
echo "=============================="
echo "  Installation complete."
echo ""
echo "  IMPORTANT: You also need the"
echo "  Termux:API companion app from"
echo "  F-Droid or the Play Store."
echo ""
echo "  To start Claude Code, open a"
echo "  new Termux session or run:"
echo "    proot -b \$TMPDIR:/tmp claude"
echo "=============================="
echo ""
