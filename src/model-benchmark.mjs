export async function benchmarkModel(runtime,{signal,repetitions=3}={}){
  if(runtime.status!=='ready' || runtime.remote || !runtime.model)throw new Error('Load a local model before benchmarking.');
  const rates=[];for(let i=0;i<repetitions;i++){
    signal?.throwIfAborted();const response=await runtime.completion({messages:[{role:'user',content:'Describe how a lighthouse helps ships navigate safely. Use several complete sentences.'}],temperature:0,max_tokens:96,stream:false},signal);const value=await response.json();const rate=value.timings?.predicted_per_second,count=value.timings?.predicted_n;
    if(!Number.isFinite(rate) || rate<=0 || !Number.isFinite(count) || count<8)throw new Error('The runtime did not report enough generation timing data for a useful measurement.');rates.push(rate);
  }
  return {samples:rates,mean:rates.reduce((sum,n)=>sum+n,0)/rates.length,min:Math.min(...rates),max:Math.max(...rates),measuredAt:Date.now(),modelBytes:runtime.model.bytes,modelMtimeMs:runtime.model.mtimeMs,mode:runtime.plan?.mode || 'unknown',gpuLayers:runtime.plan?.gpuLayers || 0,contextSize:runtime.configuration?.contextSize || null};
}
