const { contextBridge, ipcRenderer } = require('electron');

let syncProgressCallback = null;
ipcRenderer.on('sync-progress', (e, data) => {
  if (syncProgressCallback) syncProgressCallback(data);
});

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('minimize-window'),
  close: () => ipcRenderer.send('close-window'),
  fetchGitHubData: (config) => ipcRenderer.invoke('github-fetch-data', config),
  fullSync: (config) => ipcRenderer.invoke('github-full-sync', config),
  onSyncProgress: (callback) => {
    syncProgressCallback = callback;
  }
});