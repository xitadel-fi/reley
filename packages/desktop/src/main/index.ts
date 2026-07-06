import { join } from 'node:path';
import { BrowserWindow, Menu, app, ipcMain, nativeImage } from 'electron';
import { getAppStore } from './app-store';
import { registerIpc } from './ipc';
import {
  appHasOpenWindows,
  focusOrOpenProjectWindow,
  showWelcomeWindow,
} from './project-windows';
import { stopAllWatchers } from './file-watcher';
import { setWorkerScriptPath, shutdownAll } from './workerMgr';

// Brand identity — must run before app.whenReady() so the dock label,
// menu-bar app name, and About panel pick it up in dev preview too.
// (Packaged builds get this from Info.plist / electron-builder's productName.)
app.setName('Reley');
if (process.platform === 'win32') app.setAppUserModelId('io.reley.desktop');

const brandIconPath = join(
  __dirname,
  '../../build',
  process.platform === 'win32'
    ? 'icon.ico'
    : process.platform === 'darwin'
      ? 'icon.icns'
      : 'icon.png',
);

app.setAboutPanelOptions({
  applicationName: 'Reley',
  applicationVersion: app.getVersion(),
  copyright: 'Copyright © 2026 hoangtuanictvn',
  iconPath: brandIconPath,
});

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

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const store = getAppStore();

  const recents = store.recentProjects();
  const recentsSubmenu: Electron.MenuItemConstructorOptions[] = recents.length
    ? recents.map((r) => ({
        label: `${r.name}  —  ${r.path}`,
        click: () => focusOrOpenProjectWindow(r.path).catch((err) => console.error(err)),
      }))
    : [{ label: 'No recent projects', enabled: false }];

  const fileMenu: Electron.MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Project…',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => showWelcomeWindow(),
      },
      {
        label: 'Open Project…',
        accelerator: 'CmdOrCtrl+O',
        click: () => showWelcomeWindow(),
      },
      { type: 'separator' },
      {
        label: 'Open Recent',
        submenu: recentsSubmenu,
      },
      { type: 'separator' },
      {
        label: 'Export Project as .zip…',
        accelerator: 'CmdOrCtrl+Shift+E',
        click: () => {
          const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          win?.webContents.send('relay:menu', 'export-project');
        },
      },
      {
        label: 'Import Project from .zip…',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => {
          const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          win?.webContents.send('relay:menu', 'import-project');
        },
      },
      { type: 'separator' },
      {
        label: 'Close Window',
        accelerator: 'CmdOrCtrl+W',
        role: 'close',
      },
    ],
  };

  const template: Electron.MenuItemConstructorOptions[] = [];
  const settingsItem: Electron.MenuItemConstructorOptions = {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      win?.webContents.send('relay:menu', 'open-settings');
    },
  };

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        settingsItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  template.push(fileMenu);
  template.push({ role: 'editMenu' });
  template.push({
    label: 'View',
    submenu: [
      {
        label: 'Show Welcome Intro Again',
        click: () => {
          const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          win?.webContents.send('relay:menu', 'show-welcome-intro');
        },
      },
      {
        label: 'Show Quick-Start Tour',
        click: () => {
          const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          win?.webContents.send('relay:menu', 'show-tour');
        },
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });
  template.push({ role: 'windowMenu' });
  if (!isMac) {
    template.push({ label: 'Preferences', submenu: [settingsItem] });
  }

  return Menu.buildFromTemplate(template);
}

function refreshMenu(): void {
  Menu.setApplicationMenu(buildMenu());
}

app.whenReady().then(async () => {
  setWorkerScriptPath(join(__dirname, 'worker.cjs'));

  // macOS dock icon in dev preview — packaged .app uses Info.plist instead.
  if (process.platform === 'darwin' && app.dock) {
    try {
      const img = nativeImage.createFromPath(brandIconPath);
      if (!img.isEmpty()) app.dock.setIcon(img);
    } catch {
      /* ignore */
    }
  }

  await getAppStore().load();
  registerIpc();
  registerWindowControls();
  refreshMenu();

  // Refresh menu when recents change (every 5 seconds is sufficient; could be event-driven later).
  setInterval(refreshMenu, 5000);

  showWelcomeWindow();

  app.on('activate', () => {
    if (!appHasOpenWindows()) showWelcomeWindow();
  });
});

app.on('window-all-closed', async () => {
  stopAllWatchers();
  await shutdownAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  stopAllWatchers();
  await shutdownAll();
});
