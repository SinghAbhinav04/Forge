import net from 'node:net';
const endpoint='https://ollama.com/api/web_search';
function publicLink(url){const hostname=url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');return !['localhost','localhost.localdomain'].includes(hostname) && !hostname.endsWith('.localhost') && !hostname.endsWith('.local') && net.isIP(hostname)===0;}
export async function searchWeb(query,key,{fetchImpl=fetch,signal}={}){
  if(typeof query!=='string' || !query.trim() || query.length>1000)throw new Error('Enter a search query of at most 1,000 characters.');
  if(typeof key!=='string' || !key.trim() || key.length>512 || /[\r\n]/.test(key))throw new Error('Enter your Ollama web search API key.');
  const timeout=AbortSignal.timeout(15000);const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({query:query.trim(),max_results:5}),redirect:'error',signal:signal ? AbortSignal.any([signal,timeout]) : timeout});
  if(!response.ok)throw new Error(`Web search returned HTTP ${response.status}. Check your API key or try again.`);
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw new Error('Web search response is too large.');chunks.push(chunk);}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(value.results))throw new Error('Web search returned an invalid response.');
  const results=[];for(const item of value.results){if(typeof item?.url!=='string' || typeof item?.content!=='string')continue;let url;try{url=new URL(item.url);}catch{continue;}if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.href.length>180 || !publicLink(url))continue;results.push({title:typeof item.title==='string'?item.title.slice(0,200):url.hostname,url:url.href,snippet:item.content.slice(0,4000)});if(results.length===5)break;}return results;
}
