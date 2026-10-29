#!/usr/bin/env node
import { createCordenarServer } from './server.js';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

console.error('Cordenar MCP server — waiting on stdin (launched by your host). For the dashboard: cordenar dashboard. Ctrl+C to exit.');

const server = createCordenarServer();
const transport = new StdioServerTransport();
await server.connect(transport);
