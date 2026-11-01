import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const output=path.resolve('test-artifacts'); await fs.mkdir(output,{ recursive:true });
const testRoot=await fs.mkdtemp(path.join(output,'features-'));
const env={ ...process.env,LOCAL_DESK_TEST_ROOT:testRoot }; delete env.ELECTRON_RUN_AS_NODE;
const remote=http.createServer(async (req,res) => {
  if (req.headers.authorization!=='Bearer fixture-key') { res.writeHead(401); res.end(); return; }
  if (req.url==='/v1/models') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ data:[{ id:'fixture-model' }] })); return; }
  const body=[]; for await (const chunk of req) body.push(chunk); const request=JSON.parse(Buffer.concat(body)); assert.ok(request.messages.some(m => m.content.includes('persistent note')));
  res.writeHead(200,{ 'Content-Type':'text/event-stream' });
  for (const content of ['Hello from ','the remote fixture.']) res.write(`data: ${JSON.stringify({ choices:[{ delta:{ content } }] })}\n\n`);
  res.end(`data: ${JSON.stringify({ choices:[{ delta:{},finish_reason:'stop' }],usage:{ prompt_tokens:42,completion_tokens:7 } })}\n\ndata: [DONE]\n\n`);
});
await new Promise(r => remote.listen(0,'127.0.0.1',r));
let app; let page; const errors=[];
const start=async () => { app=await electron.launch({ args:['.'],env,timeout:60000 }); page=await app.firstWindow(); page.on('pageerror',e => errors.push(e.message)); await page.waitForFunction(() => document.getElementById('hardware-label')?.textContent.includes('GB RAM')); };
const api=(route,body) => page.evaluate(async ([route,body]) => { const response=await fetch(route,{ method:body===undefined ? 'GET' : 'POST',headers:{ 'X-Local-Desk-Token':sessionStorage.getItem('local-desk-token'),'Content-Type':'application/json' },...(body===undefined ? {} : { body:JSON.stringify(body) }) }); const result=await response.json(); if (!response.ok) throw new Error(result.error); return result; },[route,body]);
const panel=async name => { await page.locator('[data-view="settings"]').click(); await page.locator(`[data-panel="${name}"]`).click(); await page.locator(`#panel-${name}`).waitFor(); };
try {
  await start();
  for (const name of ['general','chat','agent','voice','usage','appearance','sessions','developer','mcp','skills','devices','explore','instances','api','defaults','runtime']) { await panel(name); assert.ok(await page.locator(`#panel-${name} h2`).textContent()); }
  await page.screenshot({ path:path.join(output,'forge-runtime.png') });
  await panel('runtime'); await page.locator('#execution-mode').selectOption('cpu'); await page.getByRole('button',{ name:'Save runtime settings',exact:true }).click();
  await page.waitForFunction(() => document.querySelector('#execution-mode').value==='cpu'); assert.equal((await api('/api/bootstrap')).settings.executionMode,'cpu');
  await panel('appearance'); await page.locator('#panel-appearance [data-setting="theme"]').selectOption('light'); await page.locator('#panel-appearance [data-setting="fontSize"]').fill('15'); await page.locator('#panel-appearance button[type="submit"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme==='light'); await page.screenshot({ path:path.join(output,'forge-light.png') });
  await panel('defaults'); await page.locator('#setting-temperature').fill('0.45'); await page.locator('#setting-systemPrompt').fill('You are Forge. Keep replies concise.'); await page.getByRole('button',{ name:'Save settings',exact:true }).click();
  await page.waitForFunction(() => document.getElementById('settings-saved').textContent.startsWith('Saved.'));
  await page.locator('#panel-defaults [data-setting="topP"]').fill('0.88'); await page.locator('#panel-defaults form:has([data-setting="topP"]) button[type="submit"]').click();
  await page.waitForTimeout(300); assert.equal((await api('/api/bootstrap')).settings.topP,.88);
  await panel('skills'); await page.locator('#skill-name').fill('Brief answers'); await page.locator('#skill-instructions').fill('Use one concise paragraph.'); await page.locator('#skill-enabled').check(); await page.locator('#skill-form button[type="submit"], #skill-form button.primary-button').click();
  await page.locator('#skill-list').getByText('Brief answers',{ exact:true }).waitFor();
  await panel('mcp'); await page.locator('#mcp-name').fill('Local echo test'); await page.locator('#mcp-command').fill(process.execPath); await page.locator('#mcp-args').fill(JSON.stringify([path.resolve('test/mcp-fixture.mjs')])); await page.locator('#mcp-form button.primary-button').click();
  await page.locator('#mcp-list').getByRole('button',{ name:'Connect',exact:true }).click(); await page.locator('#mcp-list').getByText('Connected · stdio · 1 tools',{ exact:true }).waitFor();
  await panel('devices'); await page.locator('#device-name').fill('Fixture PC'); await page.locator('#device-base').fill(`http://127.0.0.1:${remote.address().port}/v1`); await page.locator('#device-key').fill('fixture-key'); await page.locator('#device-form button.primary-button').click();
  await page.locator('#device-list').getByRole('button',{ name:'Fetch models',exact:true }).click(); await page.getByRole('button',{ name:'Use fixture-model',exact:true }).click(); await page.locator('#active-model-label').getByText('fixture-model',{ exact:false }).waitFor();
  const initial=await api('/api/bootstrap'); const created=await api('/api/sessions',{ kind:'chat' });
  await api('/api/session/update',{ id:created.id,title:'Persistence check',memory:'A persistent note about this project.' }); await api('/api/session/select',{ workspaceId:initial.workspaces[0].id,sessionId:created.id }); await page.reload();
  await page.waitForFunction(() => document.getElementById('page-title').textContent==='Persistence check');
  await panel('sessions'); assert.equal(await page.locator('#session-memory').inputValue(),'A persistent note about this project.');
  await page.getByRole('button',{ name:'Fork current',exact:true }).click(); await page.waitForFunction(() => document.getElementById('page-title').textContent.includes('(fork)'));
  const selected=(await api('/api/bootstrap')).selection.sessionId;
  await page.locator('[data-view="chat"]').click(); await page.locator('#prompt').fill('Hello, remember my saved notes.'); await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelectorAll('.message.assistant .message-body').length>0 && document.querySelector('.message.assistant .message-body').textContent.includes('remote fixture') && document.getElementById('stop-task').hidden);
  const chat=JSON.parse(await fs.readFile(path.join(testRoot,'data','sessions','chats',`${selected}.json`),'utf8')); assert.equal(chat.messages.at(-1).content,'Hello from the remote fixture.'); assert.ok(chat.memory.includes('persistent note'));
  await page.screenshot({ path:path.join(output,'forge-workspace.png') });
  await panel('usage'); assert.ok((await page.locator('#usage-stats').textContent()).includes('42'));
  await panel('api'); await page.locator('#panel-api [data-setting="apiPort"]').fill('23479'); await page.locator('#panel-api button[type="submit"]').click(); await page.waitForTimeout(250); await page.locator('#api-start').click(); await page.waitForFunction(() => document.getElementById('local-api-status').textContent.includes('Running'));
  await page.locator('#api-key-show').click(); await page.waitForFunction(() => document.getElementById('api-key-value').value.length===64); const key=await page.locator('#api-key-value').inputValue(); const served=await fetch('http://127.0.0.1:23479/v1/models',{ headers:{ Authorization:`Bearer ${key}` } }); assert.equal((await served.json()).data[0].id,'fixture-model'); await page.locator('#api-stop').click();
  await panel('sessions'); await page.locator('#session-archive').click(); await panel('sessions'); await page.locator('#archived-sessions').getByRole('button',{ name:'Restore',exact:true }).click();
  const engine=JSON.parse(await fs.readFile(path.resolve('.data/voice-runtime/current.json'),'utf8'));
  await panel('voice'); await page.locator('#panel-voice [data-setting="voiceRuntimePath"]').fill(engine.executable); await page.locator('#panel-voice [data-setting="voiceModelPath"]').fill(engine.model); await page.locator('#panel-voice button[type="submit"]').click(); await page.waitForTimeout(250);
  await page.locator('#voice-wav').setInputFiles(path.resolve('test-artifacts/voice/jfk.wav')); await page.waitForFunction(() => document.getElementById('voice-status').textContent==='Transcription complete.',null,{ timeout:120000 }); assert.ok((await page.locator('#voice-transcript').inputValue()).length>60);
  await page.screenshot({ path:path.join(output,'forge-voice.png') });
  await page.locator('[data-view="trainer"]').click(); await page.locator('#training-form').waitFor(); await page.screenshot({ path:path.join(output,'forge-trainer.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),false);
  assert.ok(app.process().exitCode===null); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await panel('sessions'); await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname==='/api/session/select' && r.request().method()==='POST' && Boolean(r.request().postDataJSON()?.sessionId) && r.ok()),page.locator('#sessions .session-row button').first().click()]);
  const before=(await api('/api/bootstrap')).selection.sessionId; await app.close(); app=null; await start();
  await page.waitForFunction(() => document.querySelector('.message.assistant .message-body')?.textContent.includes('remote fixture'));
  assert.equal((await api('/api/bootstrap')).selection.sessionId,before); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme),'light');
  assert.deepEqual(errors,[]);
  console.log('Forge feature desktop smoke passed: all settings pages, runtime mode, appearance, advanced sampling, skills, MCP, remote chat, session persistence/fork/archive, local API, real voice transcription, Trainer UI, background close, and relaunch.');
} finally { if (app) await app.close(); await new Promise(r => remote.close(r)); }
