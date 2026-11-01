const path=require('node:path');
const { pathToFileURL }=require('node:url');
let backend;
process.parentPort.on('message',async ({ data }) => {
  try {
    if (data.type==='start') {
      const { createApplication }=await import(pathToFileURL(path.join(__dirname,'server.mjs')).href);
      backend=await createApplication({ ...data.options,onSettings:settings => process.parentPort.postMessage({ type:'settings',settings }) });
      process.parentPort.postMessage({ type:'ready',url:backend.url,settings:backend.store.state.settings });
    } else if (data.type==='close') { if (backend) await backend.close(); process.parentPort.postMessage({ type:'closed' }); process.exit(0); }
    else if (data.type==='stop-model') { backend?.agent.cancel(); for (let i=0;backend?.agent.active && i<50;i++) await new Promise(r => setTimeout(r,100)); if (backend) { await backend.features.localApi.stop(); await backend.runtime.stop(); } }
    else if (data.type==='paths') { const locations={ chats:backend.store.state.settings.sessionDir,data:backend.store.dataDir,skills:backend.features.skills.directory,trained:backend.features.adapters.directory }; process.parentPort.postMessage({ type:'paths',requestId:data.requestId,path:locations[data.kind] || backend.store.dataDir }); }
  } catch (error) { process.parentPort.postMessage({ type:'error',message:error.stack || error.message }); }
});
