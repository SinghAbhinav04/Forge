import { parentPort,workerData } from 'node:worker_threads';
import { extractDocument } from './datasets.mjs';

try { const text=await extractDocument(workerData.file);parentPort.postMessage({text:text.slice(0,1_000_001)}); }
catch(error) { parentPort.postMessage({error:error.message || 'Document extraction failed.'}); }
