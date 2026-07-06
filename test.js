import fs from 'fs';
import path from 'path';

const envContent = fs.readFileSync('.env', 'utf-8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
});

import('./api/_lib/helpers.js').then(async ({ callOpenAI }) => {
  const text = 'These AI gadgets tap into natural language processing. They churn out text that passes for human. Casual chats slide into stiff articles or research pieces without missing a beat.';
  try {
    console.log('Testing grok-4.3...');
    const r1 = await callOpenAI('test', text, 0.95, 'grok-4.3');
    console.log('grok-4.3 OK:', r1.substring(0, 50));

    console.log('Testing grok-4.20-0309-reasoning...');
    const r2 = await callOpenAI('test', text, 0.95, 'grok-4.20-0309-reasoning');
    console.log('grok-4.20-0309-reasoning OK:', r2.substring(0, 50));

    console.log('Testing grok-4.20-multi-agent-0309...');
    const r3 = await callOpenAI('test', text, 0.95, 'grok-4.20-multi-agent-0309');
    console.log('grok-4.20-multi-agent-0309 OK:', r3.substring(0, 50));
    
  } catch(e) {
    console.error(e);
  }
});
