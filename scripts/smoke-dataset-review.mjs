import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises'; import path from 'node:path'; import assert from 'node:assert/strict';
const output=path.resolve('test-artifacts'); await fs.mkdir(output,{recursive:true}); const root=await fs.mkdtemp(path.join(output,'dataset-review-')); const env={...process.env,LOCAL_DESK_TEST_ROOT:root}; delete env.ELECTRON_RUN_AS_NODE;
const file=path.join(root,'whatsapp.txt'); await fs.writeFile(file,'01/11/2026, 8:01 pm - Abhinav: Opening\n01/11/2026, 8:02 pm - Rahul: Free tonight?\n01/11/2026, 8:03 pm - Abhinav: After eight.\n01/11/2026, 8:04 pm - Rahul: Great!');
let app; const errors=[];
try {
 app=await electron.launch({args:['.'],env,timeout:60000}); const page=await app.firstWindow(); page.on('pageerror',e=>errors.push(e.message)); await page.locator('.tools-nav > summary').click(); await page.locator('[data-view=trainer]').click();
 await page.locator('#train-dataset').fill(file); assert.equal(await page.locator('#training-start').isDisabled(),true); await page.locator('#dataset-detect').click(); await page.locator('#dataset-speaker').waitFor(); assert.equal(await page.locator('#dataset-speaker').inputValue(),'');
 await page.locator('#dataset-speaker').selectOption('Abhinav'); await page.locator('#dataset-confirm').waitFor(); assert.equal(await page.locator('#training-start').isDisabled(),true);
 const sample=await page.locator('#dataset-samples').textContent(); assert.ok(sample.includes('8:02 pm')); assert.ok(sample.includes('Free tonight?')); assert.ok(sample.includes('After eight.')); assert.ok(sample.includes('target_last_reply')); await page.locator('#dataset-confirm').check(); assert.equal(await page.locator('#training-start').isEnabled(),true);
 await page.screenshot({path:path.join(output,'forge-training-data-review.png'),fullPage:true});
 await page.locator('#dataset-speaker').selectOption('Rahul'); await page.waitForFunction(()=>document.getElementById('dataset-preview').textContent.includes('(Rahul)')); assert.equal(await page.locator('#dataset-confirm').isChecked(),false); assert.equal(await page.locator('#training-start').isDisabled(),true);
 await page.locator('#train-dataset').fill(file+'-missing'); assert.equal(await page.locator('#dataset-confirm').isVisible(),false); assert.equal(await page.locator('#training-start').isDisabled(),true);
 const blocked=await page.evaluate(async file=>{ const r=await fetch('/api/trainer/start',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Desk-Token':sessionStorage.getItem('local-desk-token')},body:JSON.stringify({dataset:file})});return {status:r.status,body:await r.json()}; },file); assert.ok(blocked.status>=400); assert.match(blocked.body.error,/confirm/);
 assert.deepEqual(errors,[]); console.log('Dataset review passed: explicit participant selection, original/prepared comparison, confirmation gate, speaker/source invalidation, and backend review enforcement.');
} finally { if(app)await app.close(); }
