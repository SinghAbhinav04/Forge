import fs from 'node:fs/promises';

export function compareReleaseVersions(current,latest){
  const parse=value=>{const match=String(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/);if(!match)return null;const numbers=match.slice(1).map(Number);return numbers.every(Number.isSafeInteger) ? numbers : null;};const a=parse(current),b=parse(latest);if(!a || !b)return null;for(let i=0;i<3;i++)if(a[i]!==b[i])return b[i]>a[i] ? 1 : -1;return 0;
}
export async function checkForUpdate({fetchImpl=fetch}={}){
  const manifest=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
  const response=await fetchImpl('https://api.github.com/repos/SinghAbhinav04/Forge/releases/latest',{headers:{Accept:'application/vnd.github+json','User-Agent':'Forge-Desktop'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`GitHub returned HTTP ${response.status}. Try again later.`);const release=await response.json();const comparison=compareReleaseVersions(manifest.version,release.tag_name);if(comparison===null)throw new Error('The latest release has an unsupported version format.');
  return {current:manifest.version,latest:release.tag_name,updateAvailable:comparison>0,url:'https://github.com/SinghAbhinav04/Forge/releases'};
}
