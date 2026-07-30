// Minimal stub so that importing 'electron' in main-process files
// doesn't crash when run under Node/Vitest.

export const app = {
  getPath: (_name: string) => '/tmp/serpent-test',
  on: () => {},
  quit: () => {},
  whenReady: () => Promise.resolve(),
};

export const ipcMain = {
  handle: () => {},
  on: () => {},
};

export const BrowserWindow = class {
  show = false;
  webContents = {
    on: () => {},
    setWindowOpenHandler: () => {},
    loadURL: () => Promise.resolve(),
    executeJavaScript: () => Promise.resolve(''),
  };
  isDestroyed = () => false;
  destroy = () => {};
};

export const dialog = {
  showSaveDialog: () => Promise.resolve({ canceled: true }),
};

export const shell = {
  openExternal: () => Promise.resolve(),
};

export const session = {
  defaultSession: {
    webRequest: {
      onBeforeSendHeaders: () => {},
      onHeadersReceived: () => {},
    },
  },
};

export default { app, ipcMain, BrowserWindow, dialog, shell, session };
