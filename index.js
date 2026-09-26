#!/usr/bin/env node
import { createCordenarServer } from './server.js';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const server = createCordenarServer();
const transport = new StdioServerTransport();
await server.connect(transport);
