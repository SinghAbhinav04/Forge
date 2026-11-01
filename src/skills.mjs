import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile,listFiles } from './files.mjs';
function parse(text,name) { const front=text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/); const title=front?.[1].match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]; const instructions=(front ? text.slice(front[0].length) : text).trim(); if (!instructions || instructions.length>64000) throw new Error('Skill instructions must contain between 1 and 64,000 characters.'); return { name:(title || name).slice(0,80),instructions }; }
export class SkillLibrary {
  constructor(store) { this.store=store; this.directory=path.join(store.dataDir,'skills'); }
  async initialize() { await fs.mkdir(this.directory,{ recursive:true }); for (const skill of this.store.state.skills) { if (!skill.resourceDir) { skill.resourceDir=path.join(this.directory,skill.id); await fs.mkdir(skill.resourceDir,{ recursive:true }); await fs.writeFile(path.join(skill.resourceDir,'SKILL.md'),skill.instructions); } } }
  async save(input) {
    if (!input.name?.trim() || typeof input.instructions!=='string') throw new Error('Provide a skill name and instructions.'); const parsed=parse(input.instructions,input.name.trim()); const existing=this.store.state.skills.find(s => s.id===input.id); const id=existing?.id || randomUUID();
    const skill={ id,...parsed,enabled:input.enabled===true,resourceDir:existing?.resourceDir || path.join(this.directory,id) }; await fs.mkdir(skill.resourceDir,{ recursive:true }); await fs.writeFile(path.join(skill.resourceDir,'SKILL.md'),skill.instructions); if (existing) Object.assign(existing,skill); else this.store.state.skills.push(skill); await this.store.save(); return skill;
  }
  async importFolder(source) {
    if (typeof source!=='string' || !path.isAbsolute(source)) throw new Error('Choose an absolute skill folder.');
    const info=await fs.lstat(source); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Choose a regular skill folder.'); const text=(await readFile(source,'SKILL.md')).content; const parsed=parse(text,path.basename(source));
    const skill=await this.save({ ...parsed,enabled:true }); let bytes=0;
    const copy=async (relative,depth) => { for (const entry of await listFiles(source,relative)) { if (entry.directory) { if (depth<3) { await fs.mkdir(path.join(skill.resourceDir,entry.path),{ recursive:true }); await copy(entry.path,depth+1); } } else { const origin=path.join(source,entry.path); bytes+=(await fs.stat(origin)).size; if (bytes>2*1024**2) throw new Error('Skill resources exceed the 2 MiB import limit.'); await fs.copyFile(origin,path.join(skill.resourceDir,entry.path)); } } };
    try { await copy('.',0); await fs.writeFile(path.join(skill.resourceDir,'SKILL.md'),parsed.instructions); await this.store.save(); return skill; }
    catch (e) { this.store.state.skills=this.store.state.skills.filter(s => s.id!==skill.id); await this.store.save(); throw e; }
  }
  async scan() {
    await fs.mkdir(this.directory,{ recursive:true });
    for (const entry of await fs.readdir(this.directory,{ withFileTypes:true })) if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const directory=path.join(this.directory,entry.name); let text; try { text=(await readFile(directory,'SKILL.md')).content; } catch { continue; }
      const found=this.store.state.skills.find(s => s.resourceDir===directory); let parsed; try { parsed=parse(text,found?.name || entry.name); } catch (error) { if (found) { found.enabled=false; found.error=error.message; } continue; }
      if (found) Object.assign(found,parsed); else this.store.state.skills.push({ id:randomUUID(),...parsed,enabled:true,resourceDir:directory });
    }
    await this.store.save(); return this.store.state.skills;
  }
  async remove(id) { const skill=this.store.state.skills.find(s => s.id===id); if (!skill) throw new Error('Skill not found.'); const relative=path.relative(this.directory,skill.resourceDir); if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) { const archive=path.join(this.store.dataDir,'skills-disabled'); await fs.mkdir(archive,{ recursive:true }); try { await fs.rename(skill.resourceDir,path.join(archive,`${skill.id}-${Date.now()}`)); } catch (e) { if (e.code!=='ENOENT') throw e; } } this.store.state.skills=this.store.state.skills.filter(s => s.id!==id); await this.store.save(); }
  async resource(name,file) { const skill=this.store.state.skills.find(s => s.enabled && (s.id===name || s.name===name)); if (!skill?.resourceDir) throw new Error('Enabled skill not found.'); return readFile(skill.resourceDir,file); }
}
