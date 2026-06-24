import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('listenGraphDesktop', {
  platform: process.platform,
});
