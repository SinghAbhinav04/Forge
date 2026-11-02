import fs from 'node:fs/promises';

// Diagnostics are explicitly allowlisted: paths, logs, URLs, prompts and credentials
// must not be included in a report that users may share.
export async function diagnostics({runtime,hardware,store,trainer}) {
  let version='unknown';
  try { const manifest=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')); if(typeof manifest.version==='string')version=manifest.version; } catch {}
  const device=await hardware();
  const gpu=device.gpu ? {name:device.gpu.name,totalGiB:device.gpu.totalGiB,freeGiB:device.gpu.freeGiB,source:device.gpu.source || 'nvidia-smi'} : null;
  let runtimeInstalled=false;try{await runtime.executable(store.state.settings);runtimeInstalled=true;}catch{}
  return {app:'Forge',version,node:process.versions.node,platform:device.platform,arch:device.arch,
    hardware:{ramGiB:device.ramGiB,freeGiB:device.freeGiB,cores:device.cores,cpu:device.cpu,gpu,unifiedMemory:device.unifiedMemory},
    runtime:{installed:runtimeInstalled,status:runtime.status,source:runtime.remote ? 'remote' : 'local',busy:Boolean(runtime.busy),mode:runtime.plan?.mode || null,vision:Boolean(runtime.configuration?.vision)},
    storage:{warnings:store.warnings.length},training:{status:trainer.job?.status || 'idle'}};
}
