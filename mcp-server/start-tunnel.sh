#!/data/data/com.termux/files/usr/bin/bash
# Start MCP HTTP server + cloudflared tunnel
# Run this whenever you want Claude.ai to have live access.

LOGDIR="$HOME/mcp-context-server"

echo "Starting MCP HTTP server..."
node "$LOGDIR/http-server.js" > "$LOGDIR/http-server.log" 2>&1 &
HTTP_PID=$!
sleep 2

if ! kill -0 $HTTP_PID 2>/dev/null; then
    echo "ERROR: HTTP server failed to start. Check $LOGDIR/http-server.log"
    exit 1
fi
echo "✓ HTTP server running (pid $HTTP_PID)"

echo "Starting cloudflared tunnel..."
cloudflared tunnel --url http://localhost:3741 > "$LOGDIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
sleep 10

TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGDIR/tunnel.log" | head -1)

if [ -z "$TUNNEL_URL" ]; then
    echo "ERROR: Could not get tunnel URL. Check $LOGDIR/tunnel.log"
    exit 1
fi

echo ""
echo "=============================="
echo "  Tunnel live!"
echo ""
echo "  MCP URL for Claude.ai:"
echo "  $TUNNEL_URL/mcp"
echo ""
echo "  In Claude.ai:"
echo "  Settings → Integrations → Add MCP Server"
echo "  Paste the URL above."
echo "=============================="
echo ""

# Save URL for clipboard
echo "$TUNNEL_URL/mcp" | termux-clipboard-set 2>/dev/null && \
    echo "URL copied to clipboard."

# Save PIDs for stop script
echo "$HTTP_PID $TUNNEL_PID" > "$LOGDIR/.tunnel-pids"
