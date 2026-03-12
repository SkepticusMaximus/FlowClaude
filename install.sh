#!/data/data/com.termux/files/usr/bin/bash
# FlowClaude Bootstrap Installer
# Installs Claude Code in Termux with resilience, logging, and verification.

LOGFILE="$HOME/flowclaude-install.log"

# ── Helpers ───────────────────────────────────────────────────────────────────

log() {
    echo "$1" | tee -a "$LOGFILE"
}

fail() {
    log ""
    log "✗ ERROR: $1"
    log "  Full log: $LOGFILE"
    log "  Last 10 lines:"
    tail -n 10 "$LOGFILE" | tee -a "$LOGFILE"
    exit 1
}

retry() {
    local n=1 max=3 delay=5
    until "$@" >> "$LOGFILE" 2>&1; do
        if [ $n -ge $max ]; then
            fail "Command failed after $max attempts: $*"
        fi
        log "  Attempt $n failed. Retrying in ${delay}s..."
        sleep $delay
        n=$((n + 1))
    done
}

# ── Header ────────────────────────────────────────────────────────────────────

echo "" > "$LOGFILE"
log "=============================="
log "  FlowClaude Installer"
log "  $(date)"
log "=============================="
log ""

# ── Step 1: Pre-flight checks ─────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SRC="$SCRIPT_DIR/mcp-server"
MCP_DIR="$HOME/mcp-context-server"

log "[1/8] Running pre-flight checks..."

# Internet connectivity
log "  Checking internet..."
if ! curl -s --max-time 8 https://packages.termux.dev > /dev/null 2>&1; then
    fail "No internet connection. Please connect and try again."
fi
log "  ✓ Internet OK"

# Available storage (need at least 500MB free)
log "  Checking storage..."
FREE_KB=$(df -k "$HOME" 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt 512000 ]; then
    fail "Not enough storage. Need 500MB free, have $((FREE_KB / 1024))MB."
fi
log "  ✓ Storage OK"

# Detect existing install — skip heavy steps if already done
ALREADY_INSTALLED=false
if command -v claude > /dev/null 2>&1; then
    log "  ✓ Claude Code already installed ($(claude --version 2>/dev/null || echo 'unknown version'))"
    ALREADY_INSTALLED=true
fi

log ""

# ── Step 2: Update package lists ──────────────────────────────────────────────

if [ "$ALREADY_INSTALLED" = false ]; then
    log "[2/8] Updating Termux packages..."
    retry pkg update -y
    log "  ✓ Done"
else
    log "[2/8] Skipping pkg update (already installed)"
fi
log ""

# ── Step 3: Install dependencies ──────────────────────────────────────────────

if [ "$ALREADY_INSTALLED" = false ]; then
    log "[3/8] Installing dependencies (nodejs, git, proot, termux-api)..."
    retry pkg install -y nodejs git proot termux-api
    log "  ✓ Done"
else
    log "[3/8] Skipping package install (already installed)"
fi
log ""

# ── Step 4: Install Claude Code ───────────────────────────────────────────────

if [ "$ALREADY_INSTALLED" = false ]; then
    log "[4/8] Installing Claude Code via npm..."
    retry npm install -g @anthropic-ai/claude-code
    log "  ✓ Done"
else
    log "[4/8] Skipping Claude Code install (already installed)"
fi
log ""

# ── Step 5: Configure .bashrc ─────────────────────────────────────────────────

log "[5/8] Configuring .bashrc..."

BASHRC="$HOME/.bashrc"
PROOT_LINE='proot -b $TMPDIR:/tmp claude'

if grep -qF "$PROOT_LINE" "$BASHRC" 2>/dev/null; then
    log "  .bashrc already configured, skipping."
else
    echo "" >> "$BASHRC"
    echo "# FlowClaude: launch Claude Code with /tmp fix" >> "$BASHRC"
    echo "$PROOT_LINE" >> "$BASHRC"
    log "  ✓ .bashrc updated"
fi
log ""

# ── Step 6: Enable external app access ────────────────────────────────────────

log "[6/8] Enabling external app access..."

TERMUX_PROPS="$HOME/.termux/termux.properties"
mkdir -p "$HOME/.termux"

if grep -qF "allow-external-apps=true" "$TERMUX_PROPS" 2>/dev/null; then
    log "  Already enabled, skipping."
else
    echo "allow-external-apps=true" >> "$TERMUX_PROPS"
    log "  ✓ Enabled"
fi

termux-reload-settings 2>/dev/null && log "  ✓ Settings reloaded" || \
    log "  ⚠ Could not reload settings — restart Termux to apply."
log ""

# ── Step 7: Local MCP server setup ───────────────────────────────────────────

if [ -d "$MCP_SRC" ]; then
    log "[7/8] Setting up local MCP context server..."

    # Copy server files if not already present
    if [ ! -d "$MCP_DIR" ]; then
        cp -r "$MCP_SRC" "$MCP_DIR"
        log "  ✓ Copied MCP server files to $MCP_DIR"
    else
        log "  MCP server directory already exists, skipping copy"
    fi

    # Install npm dependencies (production only)
    log "  Installing MCP server npm dependencies..."
    retry npm --prefix "$MCP_DIR" install --omit=dev
    log "  ✓ Dependencies installed"

    # Register with Claude Code via HTTP transport (user scope)
    log "  Registering MCP server with Claude Code..."
    if claude mcp list 2>/dev/null | grep -q "flowclaude-context"; then
        log "  Already registered, skipping"
    else
        if claude mcp add --transport http flowclaude-context \
                http://localhost:3000/mcp --scope user >> "$LOGFILE" 2>&1; then
            log "  ✓ Registered as 'flowclaude-context' (user scope)"
        else
            log "  ⚠ Could not register now — run after first 'claude' launch:"
            log "    claude mcp add --transport http flowclaude-context http://localhost:3000/mcp --scope user"
        fi
    fi

    # Add mcp-start / mcp-stop aliases to .bashrc
    if ! grep -qF "mcp-start" "$BASHRC" 2>/dev/null; then
        echo "" >> "$BASHRC"
        echo "# FlowClaude: local MCP context server" >> "$BASHRC"
        echo "alias mcp-start='node \$HOME/mcp-context-server/index.js >> \$HOME/mcp-context-server/server.log 2>&1 &'" >> "$BASHRC"
        echo "alias mcp-stop='pkill -f mcp-context-server/index.js'" >> "$BASHRC"
        log "  ✓ Added mcp-start / mcp-stop aliases to .bashrc"
    else
        log "  .bashrc MCP aliases already present, skipping"
    fi
else
    log "[7/8] Skipping MCP server setup (mcp-server directory not found)"
fi
log ""

# ── Step 8: Verification pass ─────────────────────────────────────────────────

log "[8/8] Running verification checks..."

VERIFY_FAILED=false

# node
if command -v node > /dev/null 2>&1; then
    log "  ✓ node: $(node --version)"
else
    log "  ✗ node not found in PATH"
    VERIFY_FAILED=true
fi

# claude
if command -v claude > /dev/null 2>&1; then
    log "  ✓ claude: $(claude --version 2>/dev/null || echo 'installed')"
else
    log "  ✗ claude not found in PATH"
    VERIFY_FAILED=true
fi

# proot
if command -v proot > /dev/null 2>&1; then
    log "  ✓ proot: $(proot --version 2>/dev/null | head -1 || echo 'installed')"
else
    log "  ✗ proot not found"
    VERIFY_FAILED=true
fi

# proot /tmp fix
if proot -b "$TMPDIR:/tmp" echo "proot ok" > /dev/null 2>&1; then
    log "  ✓ proot /tmp fix: working"
else
    log "  ⚠ proot /tmp fix: not working — check \$TMPDIR is set"
fi

# termux-api
if termux-clipboard-get > /dev/null 2>&1; then
    log "  ✓ termux-api: responding"
else
    log "  ⚠ termux-api: not responding (install Termux:API companion app from F-Droid)"
fi

log ""

if [ "$VERIFY_FAILED" = true ]; then
    fail "One or more verification checks failed. See log above."
fi

# ── Done ──────────────────────────────────────────────────────────────────────

log "=============================="
log "  Installation complete. ✓"
log ""
log "  IMPORTANT: Also install the"
log "  Termux:API companion app from"
log "  F-Droid if not already done."
log ""
log "  Open a NEW Termux session to"
log "  start Claude Code."
log ""
if [ -d "$MCP_DIR" ]; then
log "  Local MCP server installed at:"
log "  ~/mcp-context-server"
log ""
log "  Start it with:  mcp-start"
log "  Stop it with:   mcp-stop"
log "  (aliases active in new session)"
fi
log "=============================="
log ""
log "Full log saved to: $LOGFILE"
