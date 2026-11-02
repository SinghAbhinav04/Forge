// An additive view over the existing job owners. The owners remain responsible
// for persistence, cancellation and process lifetime; this does not create a
// second source of truth for those operations.
export function activityJobs({downloads=[],conversion,training,runtime,knowledge=[]}) {
  const states={downloading:'running',verifying:'running',pausing:'running',preparing:'running',converting:'running',quantizing:'running',publishing:'running',installing:'running',resuming:'running',loading:'running',saving:'running',running:'running',completed:'completed',paused:'paused',interrupted:'interrupted',cancelled:'cancelled',error:'failed'};
  const jobs=[];
  for(const job of downloads)jobs.push({id:`download:${job.id}`,kind:'download',status:states[job.status] || 'unknown',phase:job.status,progress:Number.isFinite(job.received) && Number.isFinite(job.bytes) && job.bytes>0 ? Math.min(1,Math.max(0,job.received/job.bytes)) : null});
  for(const [kind,job] of [['conversion',conversion?.job],['training',training?.job]])if(job)jobs.push({id:`${kind}:${job.id}`,kind,status:states[job.status] || 'unknown',phase:job.status,progress:null});
  if(runtime?.status==='loading')jobs.push({id:'runtime:load',kind:'runtime',status:'running',phase:runtime.phase || 'loading',progress:null});
  for(const job of knowledge)jobs.push({id:`knowledge:${job.id}`,kind:'knowledge',status:states[job.status] || 'unknown',phase:job.status,progress:null});
  return jobs;
}
