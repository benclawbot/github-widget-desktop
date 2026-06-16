const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('minimize-window'),
  close: () => ipcRenderer.send('close-window'),
  fetchGitHubData: (config) => ipcRenderer.invoke('github-fetch-data', config),
  fullSync: (config) => ipcRenderer.invoke('github-full-sync', config),
  onSyncProgress: (callback) => {
    ipcRenderer.on('sync-progress', (e, data) => callback(data));
  }
});