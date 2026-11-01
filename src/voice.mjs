import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export async function transcribe(settings,dataDir,base64,signal) {
  if (!settings.voiceRuntimePath || !settings.voiceModelPath) throw new Error('Choose a local whisper.cpp CLI and Whisper model in Voice settings first.');
  await fs.access(settings.voiceRuntimePath); await fs.access(settings.voiceModelPath);
  const wav=Buffer.from(base64,'base64'); if (wav.length<44 || wav.length>8*1024**2 || wav.toString('ascii',0,4)!=='RIFF' || wav.toString('ascii',8,12)!=='WAVE') throw new Error('Use a WAV recording under 8 MiB.');
  const root=path.join(dataDir,'voice'); await fs.mkdir(root,{ recursive:true }); const job=path.join(root,randomUUID()); await fs.mkdir(job); const input=path.join(job,'recording.wav'); const output=path.join(job,'transcript');
  try {
    await fs.writeFile(input,wav); let logs='';
    await new Promise((resolve,reject) => {
      const child=spawn(settings.voiceRuntimePath,['-m',settings.voiceModelPath,'-f',input,'-otxt','-of',output,'-t','2','-l',settings.voiceLanguage || 'en'],{ windowsHide:true,stdio:['ignore','pipe','pipe'],signal });
      const timer=setTimeout(() => { child.kill(); reject(new Error('Transcription timed out after three minutes.')); },180000);
      child.stdout.on('data',c => { logs=(logs+c).slice(-4000); }); child.stderr.on('data',c => { logs=(logs+c).slice(-4000); });
      child.once('error',error => { clearTimeout(timer); reject(error); }); child.once('exit',code => { clearTimeout(timer); code===0 ? resolve() : reject(new Error(`Transcription failed (${code}): ${logs}`)); });
    });
    return { text:(await fs.readFile(`${output}.txt`,'utf8')).trim() };
  } finally { const relative=path.relative(root,job); if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.rm(job,{ recursive:true,force:true }); }
}
