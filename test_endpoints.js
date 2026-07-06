import fs from 'fs';
import path from 'path';

// Setup env
const envContent = fs.readFileSync('.env', 'utf-8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
});

import variations from './api/humanize/variations.js';
import deep from './api/humanize/deep.js';

const mockReq = (body) => ({
  method: 'POST',
  headers: { 'x-lumen-client': 'v1', 'x-forwarded-for': '127.0.0.1' },
  body
});

const text = "These AI gadgets tap into natural language processing. They churn out text that passes for human. Casual chats slide into stiff articles or research pieces without missing a beat.";
const baseBody = { text, fluency: 'Standard', tone: 'Conversational', length: 'Default', model: 'grok-4.20-0309-reasoning' };

// Test variations
(async () => {
  console.log('Testing variations...');
  const resVar = {
    status: (code) => ({
      json: (data) => console.log('Variations Response:', code, Object.keys(data))
    }),
    setHeader: () => {}
  };
  
  await variations(mockReq(baseBody), resVar);
  
  console.log('Testing deep...');
  const resDeep = {
    setHeader: () => {},
    write: (data) => console.log('Deep SSE chunk:', data.replace(/\n/g, '')),
    end: () => console.log('Deep finished')
  };
  await deep(mockReq(baseBody), resDeep);
})();
