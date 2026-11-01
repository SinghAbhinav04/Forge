import path from 'node:path';
import { THEMES } from '../public/themes.js';
export function validateSettings(input, current) {
  const next = { ...current };
  for (const key of ['modelDir','runtimePath','systemPrompt','chatSystemPrompt','chatTemplate','projectorPath','voiceRuntimePath','voiceModelPath','voiceLanguage']) if (input[key]!==undefined) { if (typeof input[key]!=='string' || input[key].length>16000) throw new Error(`Invalid ${key}.`); next[key]=input[key].trim(); }
  for (const [key,min,max,integer] of [['contextSize',512,131072,1],['gpuLayers',0,999,1],['threads',1,256,1],['temperature',0,2,0],['maxTokens',16,32768,1],['batchSize',16,2048,1],['microBatchSize',16,512,1],['reserveRamGiB',1,16,0],['fontSize',11,19,1],['maxAgentSteps',1,40,1],['apiPort',1024,65535,1],['topP',0.01,1,0],['topK',0,1000,1],['minP',0,1,0],['repeatPenalty',0.1,3,0],['seed',-1,2147483647,1]]) if (input[key] !== undefined) { const v = input[key]; if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw new Error(`${key} must be between ${min} and ${max}.`); next[key] = v; }
  for (const [key,values] of Object.entries({ executionMode:['cpu','gpu','hybrid'],performanceMode:['responsive','balanced'],loadStrategy:['auto','stream','mmap'],theme:THEMES.map(t=>t.id),thinking:['auto','on','off'],apiHost:['127.0.0.1','0.0.0.0'] })) if (input[key]!==undefined) { if (!values.includes(input[key])) throw new Error(`Invalid ${key}.`); next[key]=input[key]; }
  for (const key of ['kvOnGpu','autoGpuLayers','enterToSend','restoreSession','renameAfterFork','allowReadTools','allowWriteTools','showReasoning','runInBackground']) if (input[key] !== undefined) { if (typeof input[key] !== 'boolean') throw new Error(`Invalid ${key}.`); next[key] = input[key]; }
  if (!path.isAbsolute(next.modelDir)) throw new Error('Model folder must be an absolute path.');
  for (const key of ['runtimePath','projectorPath','voiceRuntimePath','voiceModelPath']) if (next[key] && !path.isAbsolute(next[key])) throw new Error(`${key} must be absolute.`);
  if (input.imageTokens!==undefined) { if (!Number.isInteger(input.imageTokens) || input.imageTokens<256 || input.imageTokens>4096) throw new Error('Image token budget must be between 256 and 4096.'); next.imageTokens=input.imageTokens; }
  if (next.maxTokens > next.contextSize - 256) throw new Error('Maximum output tokens must leave at least 256 tokens for your prompt.');
  if (next.microBatchSize > next.batchSize) throw new Error('Micro batch cannot exceed batch size.');
  return next;
}
