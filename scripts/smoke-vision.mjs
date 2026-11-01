import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve('test-artifacts'); const root=await fs.mkdtemp(path.join(output,'vision-ui-')); const env={ ...process.env,LOCAL_DESK_TEST_ROOT:root }; delete env.ELECTRON_RUN_AS_NODE;
const projector=JSON.parse(await fs.readFile('.data/vision-projector.json','utf8')).path;
const app=await electron.launch({ args:['.'],env,timeout:60000 });
try {
  const page=await app.firstWindow(); const errors=[]; page.on('pageerror',e => errors.push(e.message)); await page.waitForFunction(() => document.getElementById('hardware-label')?.textContent.includes('GB RAM'));
  const configure=await page.evaluate(async projector => { const response=await fetch('/api/settings',{ method:'PATCH',headers:{ 'Content-Type':'application/json','X-Local-Desk-Token':sessionStorage.getItem('local-desk-token') },body:JSON.stringify({ contextSize:2048,maxTokens:256,executionMode:'gpu',gpuLayers:999,kvOnGpu:false,threads:2,loadStrategy:'stream',performanceMode:'responsive',reserveRamGiB:1,temperature:0,thinking:'off',projectorPath:projector,imageTokens:1120 }) }); return response.json(); },projector); if (configure.error) throw new Error(configure.error);
  await page.locator('[data-view="models"]').click();
  const [loaded]=await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname==='/api/model/load'),page.getByRole('button',{ name:'Load model',exact:true }).first().click()]); if (!loaded.ok()) throw new Error((await loaded.json()).error);
  await page.waitForFunction(() => ['Model ready','Runtime needs attention'].includes(document.getElementById('library-runtime-status').textContent),null,{ timeout:180000 }); if ((await page.locator('#library-runtime-status').textContent())!=='Model ready') throw new Error(await page.locator('#library-runtime-detail').textContent());
  const image=await page.evaluate(() => { const c=document.createElement('canvas'); c.width=600; c.height=400; const x=c.getContext('2d'); x.fillStyle='white'; x.fillRect(0,0,600,400); x.fillStyle='red'; x.fillRect(70,100,160,160); x.fillStyle='blue'; x.beginPath(); x.arc(420,180,80,0,2*Math.PI); x.fill(); return c.toDataURL('image/png').split(',')[1]; });
  const file=path.join(root,'shapes.png'); await fs.writeFile(file,Buffer.from(image,'base64'));
  await page.locator('[data-view="chat"]').click(); await page.locator('#image-input').setInputFiles(file); await page.locator('.pending-image').waitFor(); await page.locator('#prompt').fill('Describe the two colored shapes in this image in one sentence.'); await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('.message.assistant .message-body')?.textContent.trim() && document.getElementById('stop-task').hidden,null,{ timeout:180000 }); const answer=await page.locator('.message.assistant .message-body').last().textContent(); if (await page.locator('#task-notice').isVisible()) throw new Error(await page.locator('#task-notice').textContent());
  assert.ok(/red/i.test(answer) && /blue/i.test(answer),`Vision answer did not identify the colors: ${answer}`); assert.equal(await page.locator('.message-images img').count(),1);
  await page.screenshot({ path:path.join(output,'forge-vision.png') });
  await page.locator('#new-session').click(); await page.locator('#prompt').fill('Explain GGUF in two short sentences.'); await page.locator('#send').click(); await page.waitForFunction(() => document.querySelector('.message.assistant .message-body')?.textContent.trim() && document.getElementById('stop-task').hidden,null,{ timeout:120000 });
  const index=JSON.parse(await fs.readFile(path.join(root,'data/state.json'),'utf8')); const chat=JSON.parse(await fs.readFile(path.join(index.settings.sessionDir,`${index.selection.sessionId}.json`),'utf8')); const final=chat.messages.filter(m => m.role==='assistant').at(-1); assert.ok(final.metrics?.tokensPerSecond>0);
  await fs.writeFile(path.join(output,'vision-result.json'),JSON.stringify({ answer,text:final.content,metrics:final.metrics },null,2)); assert.deepEqual(errors,[]);
  console.log(`Vision smoke passed: Gemma recognized the image, saved the attachment, and generated text at ${final.metrics.tokensPerSecond.toFixed(1)} tokens/s${final.metrics.estimatedRate ? ' (wall-clock estimate)' : ''}.`);
} finally { await app.close(); }
