import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';

const reference=/^([a-f0-9]{64})\.(jpeg|png|webp)$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function prepareImages(dataDir,images=[]) {
  const root=path.join(dataDir,'attachments');
  for(const image of images){
    const match=typeof image.url==='string' && image.url.match(/^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/=]+)$/);if(!match)continue;
    const bytes=Buffer.from(match[2],'base64');const ref=`${digest(bytes)}.${match[1]}`;const target=path.join(root,ref);await fs.mkdir(root,{recursive:true});
    const temporary=path.join(root,`.attachment-${randomUUID()}.tmp`);
    try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});try{await fs.link(temporary,target);}catch(error){if(error.code==='EEXIST'){if(digest(await fs.readFile(target))!==ref.slice(0,64))throw new Error('A saved image attachment is damaged.');}else if(['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV'].includes(error.code)){try{await fs.copyFile(temporary,target,(await import('node:fs')).constants.COPYFILE_EXCL);}catch(copyError){if(copyError.code!=='EEXIST' || digest(await fs.readFile(target))!==ref.slice(0,64))throw copyError;}}else throw error;}}
    finally{await fs.rm(temporary,{force:true});}
    image.ref=ref;
  }
  return images;
}
export async function hydrateSessionImages(dataDir,session){
  for(const message of session.messages || [])for(const image of message.images || []){
    if(typeof image.url==='string'){if(!image.ref)await prepareImages(dataDir,[image]);continue;}
    const match=typeof image.ref==='string' && image.ref.match(reference);if(!match)throw new Error('Invalid saved image attachment reference.');
    const bytes=await fs.readFile(path.join(dataDir,'attachments',image.ref));if(digest(bytes)!==match[1])throw new Error('A saved image attachment is damaged.');
    image.url=`data:image/${match[2]};base64,${bytes.toString('base64')}`;
  }
  return session;
}
export function serializeSession(session){return JSON.stringify(session,function(key,value){if(key==='url' && typeof value==='string' && value.startsWith('data:image/') && reference.test(this?.ref || ''))return undefined;return value;},2);}
