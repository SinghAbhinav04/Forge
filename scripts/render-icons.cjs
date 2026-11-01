const { app,BrowserWindow }=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
app.whenReady().then(async () => {
  const win=new BrowserWindow({ show:false,webPreferences:{ sandbox:true,contextIsolation:true,nodeIntegration:false } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const source=await fs.readFile(path.resolve('public/icon.svg'),'utf8');
  for (const [filename,svg,size] of [['icon.png',source,512],['trayTemplate.png','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M15 9h38l-5 12H29v10h17l-5 12H29v13H15Z" fill="black"/></svg>',64]]) {
    const uri=`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const data=await win.webContents.executeJavaScript(`(async()=>{const i=new Image();i.src=${JSON.stringify(uri)};await i.decode();const c=document.createElement('canvas');c.width=c.height=${size};c.getContext('2d').drawImage(i,0,0,${size},${size});return c.toDataURL('image/png').split(',')[1]})()`);
    await fs.writeFile(path.resolve('public',filename),Buffer.from(data,'base64'));
  }
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
