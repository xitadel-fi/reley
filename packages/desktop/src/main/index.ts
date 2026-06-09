import { join } from 'node:path';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { registerIpc } from './ipc';
import { awaitReady, setWorkerScriptPath, shutdown, spawnWorker } from './workerMgr';

const isDev =
  process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL !== undefined;

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  const iconPath = join(
    __dirname,
    '../../build',
    process.platform === 'win32' ? 'icon.ico' : 'icon.png',
  );
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    frame: isLinux ? false : undefined,
    backgroundColor: '#0c0e12',
    ...(process.platform === 'win32' && {
      titleBarOverlay: {
        color: '#0c0e12',
        symbolColor: '#e4e7ee',
        height: 40,
      },
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

function registerWindowControls(): void {
  ipcMain.on('relay:window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.on('relay:window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('relay:window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
}

app.whenReady().then(async () => {
  setWorkerScriptPath(join(__dirname, 'worker.cjs'));
  spawnWorker();
  await awaitReady();
  registerIpc();
  registerWindowControls();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await shutdown();
});
