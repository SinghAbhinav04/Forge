import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWeb } from '../src/web-search.mjs';

test('web search sends only the explicit query to the fixed provider and filters unsafe links',async()=>{
 let request;const results=await searchWeb('recent updates','test-key',{fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({results:[{title:'Result',url:'https://example.org/page',content:'Evidence snippet'},{title:'Bad',url:'javascript:alert(1)',content:'bad'},{title:'Credentials',url:'https://user:pass@example.org/',content:'bad'}]}));}});
 assert.equal(request.url,'https://ollama.com/api/web_search');assert.equal(request.options.redirect,'error');assert.deepEqual(JSON.parse(request.options.body),{query:'recent updates',max_results:5});assert.deepEqual(results,[{title:'Result',url:'https://example.org/page',snippet:'Evidence snippet'}]);assert.doesNotMatch(JSON.stringify(results),/test-key/);
 await assert.rejects(()=>searchWeb('','x'),/search query/);await assert.rejects(()=>searchWeb('query','bad\nkey'),/API key/);
});
