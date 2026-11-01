import fs from 'node:fs/promises';
import path from 'node:path';
export async function findProjectors(directory) {
  const files=[];
  async function visit(folder,depth) {
    for(const entry of await fs.readdir(folder,{withFileTypes:true})) {
      if(entry.isSymbolicLink()) continue; const file=path.join(folder,entry.name);
      if(entry.isDirectory() && depth<2) await visit(file,depth+1);
      else if(entry.isFile() && /(?:mmproj|projector).*\.gguf$/i.test(entry.name)) files.push({path:file,name:entry.name,bytes:(await fs.stat(file)).size});
    }
  }
  try { await visit(directory,0); } catch(error) { if(error.code!=='ENOENT') throw error; }
  return files.sort((a,b)=>a.bytes-b.bytes);
}
