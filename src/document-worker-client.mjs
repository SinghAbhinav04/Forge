import { Worker } from 'node:worker_threads';

export async function extractInWorker(file,{signal}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    let settled=false;const worker=new Worker(new URL('./knowledge-worker.mjs',import.meta.url),{workerData:{file}});
    const clean=()=>signal?.removeEventListener('abort',abort);
    const finish=(error,value)=>{if(settled)return;settled=true;clean();if(error)reject(error);else resolve(value);};
    const abort=()=>{if(settled)return;settled=true;clean();const error=signal.reason || new Error('Document processing cancelled.');void worker.terminate().then(()=>reject(error),()=>reject(error));};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    worker.once('message',value=>value.error ? finish(new Error(value.error)) : finish(null,value.text));
    worker.once('error',error=>finish(error));
    worker.once('exit',code=>{if(!settled)finish(new Error(`Document worker stopped before returning a result (${code}).`));});
  });
}
