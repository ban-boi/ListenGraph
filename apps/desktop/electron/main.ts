import { app, BrowserWindow, desktopCapturer, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const isSmoke = process.env.LISTEN_GRAPH_DESKTOP_SMOKE === '1';

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: !isSmoke,
    title: 'ListenGraph Desktop',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isSmoke) {
    window.webContents.once('did-finish-load', () => {
      console.log('[desktop-smoke] renderer loaded');
      app.quit();
    });
    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`[desktop-smoke] renderer failed to load: ${code} ${description}`);
      app.exit(1);
    });
  }

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!);
    if (!isSmoke) window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(join(__dirname, '../dist/index.html'));
  }
}

function configureDesktopCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      if (sources.length === 0) {
        callback({});
        return;
      }
      callback({
        video: sources[0],
        audio: 'loopback',
      });
    },
    { useSystemPicker: true },
  );
}

app.whenReady().then(() => {
  configureDesktopCapture();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
