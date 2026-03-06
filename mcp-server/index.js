#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync, unlinkSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const CONTEXT_FILE = join(DATA_DIR, 'context.json');
const ERROR_LOG = join(DATA_DIR, 'error.log');
const PORT = process.env.PORT || 3000;

// ── Logging ───────────────────────────────────────────────────────────────────

function logError(msg) {
  const line = new Date().toISOString() + ' ' + msg + '\n';
  try { appendFileSync(ERROR_LOG, line); } catch {}
  process.stderr.write(line);
}

function logInfo(msg) {
  process.stderr.write(new Date().toISOString() + ' ' + msg + '\n');
}

// ── Data directory setup ──────────────────────────────────────────────────────

if (!existsSync(DATA_DIR)) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    process.stderr.write('Cannot create data dir: ' + e.message + '\n');
    process.exit(1);
  }
}

try {
  const testFile = join(DATA_DIR, '.write_test');
  writeFileSync(testFile, '');
  unlinkSync(testFile);
} catch (e) {
  process.stderr.write('Cannot write to data dir: ' + e.message + '\n');
  process.exit(1);
}

// ── Context load/save ─────────────────────────────────────────────────────────

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

// ── MCP Server ────────────────────────────────────────────────────────────────

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
            project: { type: 'string', description: 'Project name (optional). If omitted, returns all context.' }
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
            project: { type: 'string', description: 'Project name (e.g. FlowClaude, FlowCode, SovereignStack)' },
            content: { type: 'string', description: 'Project notes/description (replaces existing)' }
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
            note: { type: 'string', description: 'Note to append' },
            project: { type: 'string', description: 'Optional project tag' }
          }
        }
      },
      {
        name: 'get_brief',
        description: 'Generate a compact session-starter brief for pasting into Claude.ai.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'list_projects',
        description: 'List all project names with last-updated timestamps.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'post_message',
        description: 'Post a message to the queue for Claude.ai to read via GET /messages.',
        inputSchema: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', description: 'Message text for Claude.ai' }
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
        if (!p) return { content: [{ type: 'text', text: `No context found for project: ${args.project}` }] };
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
      if (!args.project || typeof args.project !== 'string' || !args.project.trim())
        return { content: [{ type: 'text', text: 'Error: project name required.' }] };
      if (!args.content || typeof args.content !== 'string' || !args.content.trim())
        return { content: [{ type: 'text', text: 'Error: content required.' }] };
      const ctx = loadContext();
      ctx.projects[args.project.trim()] = {
        content: args.content.trim(),
        updated: new Date().toISOString()
      };
      saveContext(ctx);
      return { content: [{ type: 'text', text: `Updated context for ${args.project.trim()}.` }] };
    }

    if (name === 'add_note') {
      if (!args.note || typeof args.note !== 'string' || !args.note.trim())
        return { content: [{ type: 'text', text: 'Error: note text required.' }] };
      const ctx = loadContext();
      ctx.notes.push({
        text: args.note.trim(),
        project: (args.project && typeof args.project === 'string') ? args.project.trim() : null,
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
        const full = p.content.split('\n').slice(0, 4).join(' ');
        const short = full.length > 400 ? full.substring(0, 400) + '...' : full;
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
      if (!args.text?.trim())
        return { content: [{ type: 'text', text: 'Error: text required.' }] };
      const MESSAGES_FILE = join(DATA_DIR, 'messages.json');
      const msgs = existsSync(MESSAGES_FILE)
        ? (() => { try { return JSON.parse(readFileSync(MESSAGES_FILE, 'utf8')); } catch { return []; } })()
        : [];
      msgs.push({ id: Date.now(), from: 'CC', text: args.text.trim(), date: new Date().toISOString(), read: false });
      const tmp = MESSAGES_FILE + '.tmp';
      writeFileSync(tmp, JSON.stringify(msgs, null, 2));
      renameSync(tmp, MESSAGES_FILE);
      return { content: [{ type: 'text', text: 'Message queued for Claude.ai.' }] };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  });

  return server;
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'mcp-context-server' }));
    return;
  }

  // Messages endpoint for Claude.ai polling
  if (req.method === 'GET' && url.pathname === '/messages') {
    const MESSAGES_FILE = join(DATA_DIR, 'messages.json');
    const msgs = existsSync(MESSAGES_FILE)
      ? (() => { try { return JSON.parse(readFileSync(MESSAGES_FILE, 'utf8')); } catch { return []; } })()
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(msgs));
    return;
  }

  // MCP endpoint — each POST gets its own server+transport instance (stateless)
  if (req.method === 'POST' && url.pathname === '/mcp') {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    // Collect request body
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        await server.connect(transport);
        const body = Buffer.concat(chunks);
        await transport.handleRequest(req, res, body);
      } catch (e) {
        logError('MCP request error: ' + e.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      }
    });
    return;
  }

  // Handle GET /mcp for SSE (some clients use it)
  if (req.method === 'GET' && url.pathname === '/mcp') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Use POST /mcp for MCP JSON-RPC requests' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

httpServer.listen(PORT, () => {
  logInfo(`MCP context server listening on port ${PORT}`);
  logInfo(`MCP endpoint: POST http://localhost:${PORT}/mcp`);
});

httpServer.on('error', (e) => {
  logError('HTTP server error: ' + e.message);
  process.exit(1);
});
