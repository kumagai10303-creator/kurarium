import { contextBridge, ipcRenderer } from 'electron';

export interface KurariumInfo {
  version: string;
  portable: boolean;
  autoStart: boolean;
  packaged: boolean;
}

contextBridge.exposeInMainWorld('kurarium', {
  getInfo: (): Promise<KurariumInfo> => ipcRenderer.invoke('kurarium:get-info'),
  setAutoStart: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('kurarium:set-auto-start', enabled),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('kurarium:open-external', url),
  openInBrowser: (): Promise<void> => ipcRenderer.invoke('kurarium:open-browser'),
  pickFolder: (defaultPath?: string): Promise<string[]> =>
    ipcRenderer.invoke('kurarium:pick-folder', defaultPath),
  restart: (): Promise<void> => ipcRenderer.invoke('kurarium:restart'),
  quit: (): Promise<void> => ipcRenderer.invoke('kurarium:quit'),
});
