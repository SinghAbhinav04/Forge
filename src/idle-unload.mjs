export class IdleUnloader {
  constructor(runtime,settings,blocked,unload,now=Date.now){this.runtime=runtime;this.settings=settings;this.blocked=blocked;this.unload=unload;this.now=now;this.idleSince=null;this.unloading=false;}
  async tick(){
    const runtime=this.runtime,minutes=this.settings().idleUnloadMinutes;
    if(!minutes || runtime.status!=='ready' || runtime.remote || runtime.busy || this.blocked()){this.idleSince=null;return;}
    const now=this.now();this.idleSince ??=now;const last=Math.max(this.idleSince,runtime.lastActivity || 0);
    if(!this.unloading && now-last>=minutes*60000){this.unloading=true;try{await this.unload();}finally{this.unloading=false;this.idleSince=null;}}
  }
}
