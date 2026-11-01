import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
const output = path.resolve('test-artifacts'); await fs.mkdir(output, { recursive: true });
const fixture=await fs.mkdtemp(path.join(output,'packaged-docs-'));
const stream='BT /F1 12 Tf 50 750 Td (User1: Hello) Tj 0 -20 Td (User2: Packaged PDF works) Tj ET';
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
let pdf='%PDF-1.4\n'; const offsets=[]; for (let i=0;i<objects.length;i++) { offsets.push(Buffer.byteLength(pdf)); pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`; } const start=Buffer.byteLength(pdf); pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`; await fs.writeFile(path.join(fixture,'chat.pdf'),pdf);
const zip=new JSZip(); zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'); zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'); zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>User1: Hello</w:t></w:r></w:p><w:p><w:r><w:t>User2: Packaged Word works</w:t></w:r></w:p></w:body></w:document>'); await fs.writeFile(path.join(fixture,'chat.docx'),await zip.generateAsync({ type:'nodebuffer' }));
const executable=path.resolve('dist','win-unpacked','Forge.exe');
const launchEnv = { ...process.env }; delete launchEnv.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${path.join(output, 'packaged-profile')}`], env: launchEnv, timeout: 60000 });
try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.getElementById('hardware-label')?.textContent.includes('GB RAM'));
  await page.locator('[data-view="workspace"]').click();
  await page.locator('#file-list .file-row').filter({ hasText: 'Welcome.md' }).click();
  await page.waitForFunction(() => document.getElementById('editor').value.includes('Your local workspace'));
  await page.locator('[data-view="settings"]').click();
  await page.locator('[data-panel="defaults"]').click();
  await page.locator('#setting-contextSize').waitFor();
  assert.ok(Number(await page.locator('#setting-contextSize').inputValue()) >= 512);
  for (const name of ['chat.pdf','chat.docx']) {
    const result=await page.evaluate(async file => { const r=await fetch('/api/trainer/prepare',{ method:'POST',headers:{ 'Content-Type':'application/json','X-Local-Desk-Token':sessionStorage.getItem('local-desk-token') },body:JSON.stringify({ path:file }) }); return r.json(); },path.join(fixture,name));
    assert.equal(result.examples,1,JSON.stringify(result)); assert.ok(result.preview[0].messages[1].content.includes('works'));
  }
  assert.equal(await app.evaluate(({ app }) => app.getName()),'Forge');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'packaged.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),false);
  console.log('Packaged Forge passed: native Windows launch, embedded resources, PDF/Word extraction from the archive, settings and background close.');
} finally { await app.close(); }
