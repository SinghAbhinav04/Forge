const { app,BrowserWindow,ipcMain,dialog,utilityProcess,Tray,Menu,nativeImage,shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let backend;
let window;
let quitting = false;
let tray;
let settings={ runInBackground:true };
let worker;
let backendOrigin='';
const show=() => { if (window) { window.show(); if (window.isMinimized()) window.restore(); window.focus(); } };
app.setName('Forge');
if (process.platform==='win32') app.setAppUserModelId('dev.forge.desktop');
// The interface is text/document based; reserve GPU resources for inference.
app.disableHardwareAcceleration();
if (!app.isPackaged && process.env.LOCAL_DESK_TEST_ROOT) { const profile=path.join(process.env.LOCAL_DESK_TEST_ROOT,'profile'); require('node:fs').mkdirSync(profile,{ recursive:true }); app.setPath('userData',profile); }
else if (!app.commandLine.hasSwitch('user-data-dir')) { for (const name of ['Local Desk','local-desk']) { const legacy=path.join(app.getPath('appData'),name); if (require('node:fs').existsSync(path.join(legacy,'data','state.json'))) { app.setPath('userData',legacy); break; } } }

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',show);
  app.whenReady().then(async () => {
    const userData = app.getPath('userData');
    const testRoot = !app.isPackaged && process.env.LOCAL_DESK_TEST_ROOT;
    const developmentOptions = testRoot ? {
      dataDir: path.join(testRoot, 'data'),
      workspaceDir: path.join(testRoot, 'workspace'),
      defaultModelDir: path.resolve(__dirname, '../../models')
    } : {};
    const backendOptions=app.isPackaged ? {
      dataDir: path.join(userData, 'data'),
      runtimeDir: path.join(userData, 'runtime'),
      workspaceDir:path.join(app.getPath('documents'),'Forge'),
      defaultModelDir: path.join(app.getPath('documents'), 'Models')
    } : developmentOptions;
    worker=utilityProcess.fork(path.join(__dirname,'../src/desktop-worker.cjs'),[],{ serviceName:'Forge workspace',stdio:'pipe' });
    worker.stdout?.on('data',() => {}); worker.stderr?.on('data',() => {});
    const info=await new Promise((resolve,reject) => { worker.on('message',message => { if (message.type==='ready') resolve(message); if (message.type==='settings') settings=message.settings; if (message.type==='error') reject(new Error(message.message)); }); worker.once('exit',code => { if (!quitting) reject(new Error(`Workspace process exited (${code})`)); }); worker.postMessage({ type:'start',options:backendOptions }); });
    settings=info.settings;
    backend={ url:info.url,close:() => new Promise(resolve => { const timer=setTimeout(() => { worker.kill(); resolve(); },8000); worker.once('exit',() => { clearTimeout(timer); resolve(); }); worker.postMessage({ type:'close' }); }) };
    worker.on('exit',code => { if (!quitting && backend) { backend=null; dialog.showErrorBox('Forge workspace stopped',`The workspace process exited (${code}). Reopen Forge to restore saved chats.`); quitting=true; app.quit(); } });
    const origin=new URL(backend.url).origin; backendOrigin=origin;
    const trusted = event => event.senderFrame && new URL(event.senderFrame.url).origin === origin;
    ipcMain.handle('choose-folder', async event => { if (!trusted(event)) throw new Error('Untrusted renderer.'); const r = await dialog.showOpenDialog(window, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
    ipcMain.handle('choose-runtime', async event => { if (!trusted(event)) throw new Error('Untrusted renderer.'); const r = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'llama-server', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }] }); return r.canceled ? null : r.filePaths[0]; });
    ipcMain.handle('choose-file',async (event,kind) => { if (!trusted(event)) throw new Error('Untrusted renderer.'); const extensions={ dataset:['jsonl','json','txt','md','pdf','docx','doc','csv','tsv'],skill:['md','txt'],model:['bin','gguf'],adapter:['gguf','safetensors'],audio:['wav'],runtime:process.platform==='win32' ? ['exe'] : ['*'] }; if (!extensions[kind]) throw new Error('Unknown file type.'); const r=await dialog.showOpenDialog(window,{ properties:['openFile'],filters:[{ name:kind,extensions:extensions[kind] }] }); return r.canceled ? null : r.filePaths[0]; });
    ipcMain.handle('open-storage',async (event,kind) => { if (!trusted(event) || !['chats','data','trained','skills'].includes(kind)) throw new Error('Invalid request.'); const requestId=require('node:crypto').randomUUID(); const folder=await new Promise((resolve,reject) => { const timer=setTimeout(() => { worker.off('message',listener); reject(new Error('Storage request timed out.')); },5000); const listener=m => { if (m.type==='paths' && m.requestId===requestId) { clearTimeout(timer); worker.off('message',listener); resolve(m.path); } }; worker.on('message',listener); worker.postMessage({ type:'paths',kind,requestId }); }); await require('node:fs/promises').mkdir(folder,{ recursive:true }); return shell.openPath(folder); });
    ipcMain.handle('install-shortcut',async event => {
      if (!trusted(event)) throw new Error('Untrusted renderer.'); if (!app.isPackaged) throw new Error('Install the Forge application package first. The development launcher is not registered in your app menu.');
      if (process.platform==='win32') { const folder=path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs'); await require('node:fs/promises').mkdir(folder,{ recursive:true }); if (!shell.writeShortcutLink(path.join(folder,'Forge.lnk'),{ target:process.execPath,description:'Forge local AI workspace',icon:process.execPath,iconIndex:0,appUserModelId:'dev.forge.desktop' })) throw new Error('Could not create Start menu shortcut.'); return 'Forge is registered in the Start menu.'; }
      if (process.platform==='linux') { const fs=require('node:fs/promises'); const home=app.getPath('home'); const folder=path.join(home,'.local/share/applications'); const icons=path.join(home,'.local/share/icons/hicolor/512x512/apps'); await fs.mkdir(folder,{ recursive:true }); await fs.mkdir(icons,{ recursive:true }); await fs.copyFile(path.join(__dirname,'../public/icon.png'),path.join(icons,'forge.png')); const executable=process.env.APPIMAGE || process.execPath; const escaped=executable.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%'); await fs.writeFile(path.join(folder,'dev.forge.desktop.desktop'),`[Desktop Entry]\nType=Application\nName=Forge\nComment=Local AI workspace\nExec="${escaped}"\nIcon=forge\nTerminal=false\nCategories=Utility;\nStartupWMClass=Forge\n`); return 'Forge is registered in your application menu.'; }
      return 'Move Forge.app into /Applications to make it available in Spotlight and Launchpad.';
    });
    ipcMain.handle('toggle-devtools',event => { if (!trusted(event)) throw new Error('Untrusted renderer.'); window.webContents.toggleDevTools(); });
    ipcMain.handle('release-page',event => { if (!trusted(event)) throw new Error('Untrusted renderer.'); return shell.openExternal('https://github.com/SinghAbhinav04/Forge/releases'); });
    window=new BrowserWindow({ title:'Forge',width:1450,height:960,minWidth:1000,minHeight:680,backgroundColor:'#111315',autoHideMenuBar:true,icon:path.join(__dirname,'../public/icon.png'),webPreferences:{ preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((contents,permission,callback,details) => callback(permission==='media' && new URL(contents.getURL()).origin===origin && (details.mediaTypes || []).every(t => t==='audio')));
    window.webContents.session.setPermissionCheckHandler((_contents,permission,requestingOrigin) => permission==='media' && requestingOrigin===origin);
    const icon=nativeImage.createFromPath(path.join(__dirname,'../public',process.platform==='darwin' ? 'trayTemplate.png' : 'icon.png')).resize({ width:process.platform==='darwin' ? 18 : 24,height:process.platform==='darwin' ? 18 : 24 });
    if (!icon.isEmpty()) { if (process.platform==='darwin') icon.setTemplateImage(true); tray=new Tray(icon); tray.setToolTip('Forge · local AI workspace'); tray.setContextMenu(Menu.buildFromTemplate([{ label:'Show Forge',click:show },{ label:'Stop model',click:() => worker.postMessage({ type:'stop-model' }) },{ type:'separator' },{ label:'Quit Forge',click:() => { quitting=true; app.quit(); } }])); tray.on('double-click',show); }
    window.on('close',event => { if (!quitting && settings.runInBackground && (tray || process.platform==='darwin')) { event.preventDefault(); window.hide(); } });
    app.on('activate',show);
    if (process.platform==='darwin') app.dock.setIcon(path.join(__dirname,'../public/icon.png'));
    await window.loadURL(backend.url);
  }).catch(error => { dialog.showErrorBox('Forge could not start',error.stack || error.message); quitting=true; app.quit(); });
  app.on('window-all-closed',() => { if (process.platform!=='darwin' || !settings.runInBackground) app.quit(); });
  app.on('before-quit', event => {
    if (backend) { event.preventDefault(); quitting=true; const closing=backend; backend=null; closing.close().finally(() => app.quit()); }
  });
}
