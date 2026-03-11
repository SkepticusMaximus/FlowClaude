#!/usr/bin/env node
/**
 * FlowClaude MCP HTTP Server
 * Exposes the same context tools as index.js but over HTTP/SSE
 * so Claude.ai can connect via a cloudflared tunnel.
 *
 * Run alongside index.js (which handles Claude Code via stdio).
 * Port: 3741
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync, unlinkSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import http from 'http';

// Catch anything that slips through before the server binds — ensures Railway
// logs show the real error rather than a silent exit with 502.
process.on('uncaughtException', (err) => {
  process.stderr.write(new Date().toISOString() + ' [http] UNCAUGHT EXCEPTION: ' + err.stack + '\n');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(new Date().toISOString() + ' [http] UNHANDLED REJECTION: ' + reason + '\n');
  process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const CONTEXT_FILE = join(DATA_DIR, 'context.json');
const ERROR_LOG = join(DATA_DIR, 'error.log');
const PORT = process.env.PORT || 3741;

// ── Logging ───────────────────────────────────────────────────────────────────

function logError(msg) {
  const line = new Date().toISOString() + ' [http] ' + msg + '\n';
  try { appendFileSync(ERROR_LOG, line); } catch {}
  process.stderr.write(line);
}

function logInfo(msg) {
  process.stdout.write(new Date().toISOString() + ' [http] ' + msg + '\n');
}

// ── Data directory ────────────────────────────────────────────────────────────

if (!existsSync(DATA_DIR)) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    process.stderr.write(new Date().toISOString() + ' [http] Cannot create data dir: ' + e.message + '\n');
    process.exit(1);
  }
}

// ── Context load/save (shared with stdio server) ──────────────────────────────

function defaultContext() {
  return { projects: {}, notes: [], lastUpdated: null };
}

function loadContext() {
  if (!existsSync(CONTEXT_FILE)) return defaultContext();
  try {
    return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8'));
  } catch (e) {
    logError('context.json corrupt, backing up and resetting: ' + e.message);
    try { writeFileSync(CONTEXT_FILE + '.bak', readFileSync(CONTEXT_FILE)); } catch {}
    return defaultContext();
  }
}

function saveContext(ctx) {
  ctx.lastUpdated = new Date().toISOString();
  const tmp = CONTEXT_FILE + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(ctx, null, 2));
    renameSync(tmp, CONTEXT_FILE);
  } catch (e) {
    logError('Failed to save context: ' + e.message);
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
}

// ── Message queue helpers (module-level so MCP tools can access them) ─────────

const MESSAGES_FILE = join(DATA_DIR, 'messages.json');

function loadMessages() {
  if (!existsSync(MESSAGES_FILE)) return [];
  try { return JSON.parse(readFileSync(MESSAGES_FILE, 'utf8')); } catch { return []; }
}

function saveMessages(msgs) {
  const tmp = MESSAGES_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(msgs, null, 2));
  renameSync(tmp, MESSAGES_FILE);
}

// ── MCP Server factory (one instance per HTTP connection) ─────────────────────

function createMcpServer() {
  const server = new Server(
    { name: 'mcp-context-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_context',
        description: 'Get stored context. Optionally filter by project name.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project name (optional).' }
          }
        }
      },
      {
        name: 'update_project',
        description: 'Set or update notes for a project.',
        inputSchema: {
          type: 'object',
          required: ['project', 'content'],
          properties: {
            project: { type: 'string' },
            content: { type: 'string' }
          }
        }
      },
      {
        name: 'add_note',
        description: 'Append a quick note to the general notes log.',
        inputSchema: {
          type: 'object',
          required: ['note'],
          properties: {
            note: { type: 'string' },
            project: { type: 'string' }
          }
        }
      },
      {
        name: 'get_brief',
        description: 'Generate a compact session-starter brief.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'list_projects',
        description: 'List all project names with last-updated timestamps.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'post_message',
        description: 'Post a message to CC (Claude Code). CC polls this queue and will act on messages.',
        inputSchema: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', description: 'The message or instruction for CC.' },
            from: { type: 'string', description: 'Sender name (defaults to Cai).' }
          }
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'get_context') {
      const ctx = loadContext();
      if (args.project) {
        const p = ctx.projects[args.project];
        if (!p) return { content: [{ type: 'text', text: `No context found for: ${args.project}` }] };
        return { content: [{ type: 'text', text: `## ${args.project}\n${p.content}\n\n_Updated: ${p.updated}_` }] };
      }
      const parts = [];
      for (const [pname, p] of Object.entries(ctx.projects)) {
        parts.push(`## ${pname}\n${p.content}`);
      }
      if (ctx.notes.length) {
        parts.push('## Recent Notes\n' + ctx.notes.slice(-10).map(n =>
          `- [${n.project || 'general'}] ${n.text} (${n.date})`).join('\n'));
      }
      return { content: [{ type: 'text', text: parts.join('\n\n') || 'No context stored yet.' }] };
    }

    if (name === 'update_project') {
      if (!args.project?.trim() || !args.content?.trim())
        return { content: [{ type: 'text', text: 'Error: project and content required.' }] };
      const ctx = loadContext();
      ctx.projects[args.project.trim()] = { content: args.content.trim(), updated: new Date().toISOString() };
      saveContext(ctx);
      return { content: [{ type: 'text', text: `Updated: ${args.project.trim()}` }] };
    }

    if (name === 'add_note') {
      if (!args.note?.trim())
        return { content: [{ type: 'text', text: 'Error: note text required.' }] };
      const ctx = loadContext();
      ctx.notes.push({
        text: args.note.trim(),
        project: args.project?.trim() || null,
        date: new Date().toISOString()
      });
      if (ctx.notes.length > 100) ctx.notes = ctx.notes.slice(-100);
      saveContext(ctx);
      return { content: [{ type: 'text', text: 'Note saved.' }] };
    }

    if (name === 'get_brief') {
      const ctx = loadContext();
      const lines = ['--- SESSION CONTEXT (from MCP server) ---'];
      for (const [pname, p] of Object.entries(ctx.projects)) {
        const short = p.content.split('\n').slice(0, 3).join(' ').substring(0, 200);
        lines.push(`[${pname}] ${short}`);
      }
      if (ctx.notes.length) {
        lines.push('\nRecent notes:');
        ctx.notes.slice(-5).forEach(n => lines.push(`- ${n.text}`));
      }
      lines.push('---');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'list_projects') {
      const ctx = loadContext();
      const list = Object.entries(ctx.projects)
        .map(([n, p]) => `- ${n} (updated: ${p.updated})`)
        .join('\n') || 'No projects yet.';
      return { content: [{ type: 'text', text: list }] };
    }

    if (name === 'post_message') {
      if (!args.message?.trim())
        return { content: [{ type: 'text', text: 'Error: message required.' }] };
      const msgs = loadMessages();
      const from = args.from?.trim() || 'Cai';
      msgs.push({ id: Date.now(), from, text: args.message.trim(), date: new Date().toISOString(), read: false });
      saveMessages(msgs);
      logInfo(`MCP post_message from ${from}: ${args.message.trim().substring(0, 60)}`);
      return { content: [{ type: 'text', text: `Message queued for CC. — ${from}` }] };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  });

  return server;
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const transports = new Map();

const httpServer = http.createServer(async (req, res) => {
  // CORS headers for Claude.ai
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Accept any Authorization header — no token validation
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.url === '/mcp') {
    try {
      const sessionId = req.headers['mcp-session-id'];

      // Reuse existing transport for known sessions
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId);
        await transport.handleRequest(req, res);
        return;
      }

      // New session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID()
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          logInfo(`Session closed: ${transport.sessionId}`);
        }
      };

      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);

      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
        logInfo(`New session: ${transport.sessionId}`);
      }

      await transport.handleRequest(req, res);
    } catch (e) {
      logError('Request error: ' + e.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: transports.size }));
    return;
  }

  // OAuth 2.0 Protected Resource Metadata (RFC 9728 / MCP auth spec)
  // claude.ai checks this during MCP handshake
  if (req.url === '/.well-known/oauth-protected-resource') {
    const host = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const resourceUrl = `${proto}://${host}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      resource: resourceUrl,
      authorization_servers: [],
      bearer_methods_supported: ['header'],
      resource_signing_alg_values_supported: []
    }));
    return;
  }

  // ── Plain REST endpoints for Claude.ai web_fetch ──────────────────────────

  // GET /brief — full brief (all projects + notes)
  // GET /brief/1 and /brief/2 — paginated for web_fetch tools with size limits
  if (req.method === 'GET' && (req.url === '/brief' || req.url === '/brief/1' || req.url === '/brief/2')) {
    const ctx = loadContext();
    const projectEntries = Object.entries(ctx.projects);
    const mid = Math.ceil(projectEntries.length / 2);

    let entries;
    if (req.url === '/brief/1') {
      entries = projectEntries.slice(0, mid);
    } else if (req.url === '/brief/2') {
      entries = projectEntries.slice(mid);
    } else {
      entries = projectEntries;
    }

    const lines = [`=== FlowClaude Context ${req.url === '/brief' ? '' : req.url === '/brief/1' ? '(page 1/2)' : '(page 2/2)'} ===`];
    for (const [pname, p] of entries) {
      lines.push(`\n## ${pname}`);
      lines.push(p.content);
      lines.push(`(updated: ${p.updated})`);
    }

    if (req.url !== '/brief/1') {
      if (ctx.notes.length) {
        lines.push('\n## Recent Notes');
        ctx.notes.slice(-5).forEach(n => lines.push(`- [${n.project || 'general'}] ${n.text}`));
      }
      lines.push(`\nLast updated: ${ctx.lastUpdated || 'never'}`);
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(lines.join('\n'));
    return;
  }

  // GET /context — full context for all projects
  if (req.method === 'GET' && req.url === '/context') {
    const ctx = loadContext();
    const parts = [];
    for (const [pname, p] of Object.entries(ctx.projects)) {
      parts.push(`## ${pname}\n${p.content}\n(updated: ${p.updated})`);
    }
    if (ctx.notes.length) {
      parts.push('## Notes\n' + ctx.notes.slice(-20).map(n =>
        `- [${n.project || 'general'}] ${n.text}`).join('\n'));
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(parts.join('\n\n') || 'No context stored yet.');
    return;
  }

  // GET /context/:project — single project context
  const projectMatch = req.url.match(/^\/context\/(.+)$/);
  if (req.method === 'GET' && projectMatch) {
    const ctx = loadContext();
    const name = decodeURIComponent(projectMatch[1]);
    const p = ctx.projects[name];
    if (!p) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`No context found for: ${name}\nAvailable: ${Object.keys(ctx.projects).join(', ')}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`## ${name}\n${p.content}\n\nUpdated: ${p.updated}`);
    return;
  }

  // ── Message queue — CC writes, Claude.ai reads ───────────────────────────
  // POST /message  { from, text }  → leave a message
  // GET  /messages                 → read all pending messages
  // GET  /messages?clear=true      → read and clear queue

  if (req.method === 'POST' && req.url === '/message') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { from = 'CC', text } = JSON.parse(body);
        if (!text?.trim()) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('text required');
          return;
        }
        const msgs = loadMessages();
        msgs.push({ id: Date.now(), from, text: text.trim(), date: new Date().toISOString(), read: false });
        saveMessages(msgs);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Message queued.');
        logInfo(`Message from ${from}: ${text.trim().substring(0, 60)}`);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid JSON: ' + e.message);
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/messages')) {
    const clear = req.url.includes('clear=true');
    const msgs = loadMessages();
    if (msgs.length === 0) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('No messages.');
      return;
    }
    const lines = [`=== Messages (${msgs.length}) ===`];
    msgs.forEach(m => lines.push(`\n[${m.date}] From ${m.from}:\n${m.text}`));
    if (clear) {
      saveMessages([]);
      lines.push('\n--- Queue cleared ---');
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(lines.join('\n'));
    return;
  }

  if (req.method === 'GET' && req.url === '/debrief') {
    const msgs = loadMessages();
    const latest = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(latest
      ? `=== Latest message (${latest.date}) ===\nFrom: ${latest.from}\n\n${latest.text}`
      : 'No messages.');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

httpServer.listen(PORT, '0.0.0.0', () => {
  logInfo(`MCP HTTP server listening on port ${PORT}`);
  logInfo(`Health check: http://localhost:${PORT}/health`);
  logInfo(`MCP endpoint: http://localhost:${PORT}/mcp`);
});

httpServer.on('error', (e) => {
  logError('HTTP server error: ' + e.message);
  process.exit(1);
});
