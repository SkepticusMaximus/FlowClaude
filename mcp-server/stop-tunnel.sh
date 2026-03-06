#!/data/data/com.termux/files/usr/bin/bash
# Stop MCP HTTP server and cloudflared tunnel

PIDS_FILE="$HOME/mcp-context-server/.tunnel-pids"

if [ -f "$PIDS_FILE" ]; then
    read HTTP_PID TUNNEL_PID < "$PIDS_FILE"
    kill $HTTP_PID $TUNNEL_PID 2>/dev/null
    rm "$PIDS_FILE"
    echo "✓ Tunnel stopped."
else
    # Fallback: kill by process name
    pkill -f "http-server.js" 2>/dev/null
    pkill -f "cloudflared" 2>/dev/null
    echo "✓ Processes killed."
fi
