import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function atomicJson(file,text) {
  const temp=`${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp,text,{ encoding:'utf8',mode:0o600 });
    try { await fs.rename(temp,file); }
    catch (error) {
      if (error.code!=='EXDEV') throw error;
      // Redirected Windows profiles can expose adjacent paths on different volumes.
      // Complete a recovery copy before touching the primary file. If that copy is
      // interrupted the primary survives; if replacement is interrupted it recovers.
      await fs.writeFile(`${file}.recovery`,text,{ encoding:'utf8',mode:0o600 });
      await fs.writeFile(file,text,{ encoding:'utf8',mode:0o600 });
    }
  } finally { await fs.rm(temp,{ force:true }); }
}

export async function readJson(file,onRecovery=()=>{}) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch (error) {
    if (!(error instanceof SyntaxError) && error.code!=='ENOENT') throw error;
    let recovered;
    try { recovered=JSON.parse(await fs.readFile(`${file}.recovery`,'utf8')); }
    catch { throw error; }
    try { await fs.copyFile(file,`${file}.corrupt-${randomUUID()}`); }
    catch (copyError) { if (copyError.code!=='ENOENT') throw copyError; }
    onRecovery(file); return recovered;
  }
}
