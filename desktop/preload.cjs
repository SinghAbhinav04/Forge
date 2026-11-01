const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  chooseRuntime:() => ipcRenderer.invoke('choose-runtime'),
  chooseFile:kind => ipcRenderer.invoke('choose-file',kind),
  openStorage:kind => ipcRenderer.invoke('open-storage',kind),
  toggleDevtools:() => ipcRenderer.invoke('toggle-devtools'),
  releasePage:() => ipcRenderer.invoke('release-page'),
  installShortcut:() => ipcRenderer.invoke('install-shortcut')
});
