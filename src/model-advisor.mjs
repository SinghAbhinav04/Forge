import { memoryPlan } from './hardware.mjs';

// This is a coarse CPU-only estimate. A model file does not reveal all runtime
// allocations, architecture details or whether GPU offload will be available.
export function estimateDownload(file,settings,device){
  if(file.kind!=='model' || !Number.isSafeInteger(file.bytes) || file.bytes<=0 || /-\d+-of-\d+\.gguf$/i.test(file.name || '') || !Number.isFinite(device.freeGiB))return {status:'unknown',reason:'Not enough information for a CPU estimate.'};
  const config={...settings,executionMode:'cpu',contextSize:settings.contextSize || 2048,reserveRamGiB:settings.reserveRamGiB ?? 2};
  const plan=memoryPlan({bytes:file.bytes},config,{...device,gpu:null,unifiedMemory:false});
  const available=Math.max(0,device.freeGiB-plan.reserveGiB);const status=plan.ramGiB>available ? 'unlikely' : plan.ramGiB>available*.8 ? 'tight' : 'possible';
  return {status,ramGiB:plan.ramGiB,freeGiB:device.freeGiB,reserveGiB:plan.reserveGiB,contextSize:config.contextSize,reason:'Approximate CPU-only estimate from file size and context. Architecture, projectors, adapters and other allocations may change the result; GPU offload is not included.'};
}
