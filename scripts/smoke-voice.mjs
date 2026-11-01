import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installVoice } from './install-voice.mjs';
import { transcribe } from '../src/voice.mjs';
const dataDir=path.resolve('.data'); const directory=path.join(dataDir,'voice-runtime'); let engine;
try { engine=JSON.parse(await fs.readFile(path.join(directory,'current.json'),'utf8')); } catch { engine=await installVoice({ directory }); }
if (path.basename(engine.executable)==='main.exe') { engine.executable=path.join(path.dirname(engine.executable),'whisper-cli.exe'); await fs.access(engine.executable); await fs.writeFile(path.join(directory,'current.json'),JSON.stringify(engine,null,2)); }
const output=path.resolve('test-artifacts/voice'); await fs.mkdir(output,{ recursive:true }); const sample=path.join(output,'jfk.wav');
try { await fs.access(sample); } catch { const response=await fetch('https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav'); if (!response.ok) throw new Error('Cannot download the official test sample.'); await fs.writeFile(sample,Buffer.from(await response.arrayBuffer())); }
const result=await transcribe({ voiceRuntimePath:engine.executable,voiceModelPath:engine.model,voiceLanguage:'en' },dataDir,(await fs.readFile(sample)).toString('base64'),AbortSignal.timeout(120000));
assert.ok(result.text.length>60); await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));
console.log('Local voice smoke passed: official Whisper CPU runtime transcribed a real WAV sample offline.');
