import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReleaseVersions,checkForUpdate } from '../src/updates.mjs';

test('update check compares numeric stable versions and only contacts the Forge releases API',async()=>{
 assert.equal(compareReleaseVersions('0.3.9','v0.3.10'),1);assert.equal(compareReleaseVersions('0.4.0','v0.3.99'),-1);assert.equal(compareReleaseVersions('0.3.0','v0.3.0'),0);assert.equal(compareReleaseVersions('0.3.0','v0.3.1-beta'),null);
 let url;const result=await checkForUpdate({fetchImpl:async target=>{url=target;return new Response(JSON.stringify({tag_name:'v99.0.0',html_url:'https://untrusted.example/'}));}});assert.equal(url,'https://api.github.com/repos/SinghAbhinav04/Forge/releases/latest');assert.equal(result.updateAvailable,true);assert.equal(result.url,'https://github.com/SinghAbhinav04/Forge/releases');
 await assert.rejects(()=>checkForUpdate({fetchImpl:async()=>new Response('',{status:500})}),/HTTP 500/);
});
