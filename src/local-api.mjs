import http from 'node:http';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { sseData } from './runtime.mjs';
export class LocalApi {
  constructor(runtime,store) { this.runtime=runtime; this.store=store; this.server=null; this.requests=0; this.controllers=new Set(); store.state.apiKey ||= randomBytes(32).toString('hex'); }
  snapshot() { const address=this.server?.address(); return { running:Boolean(address),host:address?.address || '',port:address?.port || null,requests:this.requests }; }
  async start(host,port) {
    if (this.server) throw new Error('Stop the API server before changing its address.');
    const server=http.createServer(async (req,res) => {
      res.setHeader('Content-Type','application/json');
      const reply=(code,value) => { res.writeHead(code); res.end(JSON.stringify(value)); };
      const supplied=req.headers.authorization || ''; const expected=`Bearer ${this.store.state.apiKey}`;
      if (Buffer.byteLength(supplied)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) return reply(401,{ error:{ message:'Invalid API key.' } });
      if (req.method==='GET' && req.url==='/v1/models') return reply(200,{ object:'list',data:this.runtime.status==='ready' ? [{ id:this.runtime.model.name,object:'model',owned_by:'forge' }] : [] });
      if (req.method!=='POST' || req.url!=='/v1/chat/completions') return reply(404,{ error:{ message:'Route not found.' } });
      if (this.runtime.busy || this.runtime.status!=='ready') return reply(409,{ error:{ message:'The model is busy or not loaded.' } });
      const controller=new AbortController(); const disconnect=() => { if (!res.writableEnded) controller.abort(); }; this.controllers.add(controller); res.once('close',disconnect);
      let acquired=false;
      try {
        let size=0; const chunks=[]; for await (const chunk of req) { size+=chunk.length; if (size>2*1024**2) throw new Error('Request too large.'); chunks.push(chunk); }
        const input=JSON.parse(Buffer.concat(chunks).toString()); if (!Array.isArray(input.messages) || !input.messages.length) throw new Error('messages must be a non-empty array.');
        if (this.runtime.busy || this.runtime.status!=='ready') return reply(409,{ error:{ message:'The model is busy or not loaded.' } });
        this.runtime.busy=true; acquired=true; this.requests++;
        const response=await this.runtime.completion({ ...input,stream:input.stream===true },controller.signal);
        if (input.stream===true) { res.writeHead(200,{ 'Content-Type':'text/event-stream','Cache-Control':'no-cache' }); for await (const event of sseData(response.body)) { if (event.usage) this.record(event.usage); res.write(`data: ${JSON.stringify(event)}\n\n`); } res.end('data: [DONE]\n\n'); }
        else { const result=await response.json(); if (result.usage) this.record(result.usage); reply(200,result); }
      } catch (error) { if (!res.headersSent) reply(400,{ error:{ message:error.message } }); else res.end(); }
      finally { this.controllers.delete(controller); res.off('close',disconnect); if (acquired) this.runtime.busy=false; }
    });
    await new Promise((resolve,reject) => server.once('error',reject).listen(port,host,resolve)); this.server=server; return this.snapshot();
  }
  record(usage) { this.store.state.usage.push({ created:Date.now(),source:'api',model:this.runtime.model?.name,...usage }); void this.store.save().catch(() => {}); }
  async stop() { if (!this.server) return; for (const controller of this.controllers) controller.abort(); const server=this.server; this.server=null; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
