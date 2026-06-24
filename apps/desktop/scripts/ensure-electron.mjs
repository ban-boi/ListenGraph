import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const DEFAULT_MIRROR = 'https://npmmirror.com/mirrors/electron/';

function getElectronDir() {
  return path.dirname(require.resolve('electron/package.json'));
}

function getPlatformPath() {
  switch (process.platform) {
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'win32':
      return 'electron.exe';
    default:
      return 'electron';
  }
}

function isInstalled(electronDir) {
  const { version } = require(path.join(electronDir, 'package.json'));
  try {
    const distVersion = fs
      .readFileSync(path.join(electronDir, 'dist', 'version'), 'utf-8')
      .replace(/^v/, '');
    if (distVersion !== version) return false;
    if (fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf-8') !== getPlatformPath()) {
      return false;
    }
  } catch {
    return false;
  }

  return fs.existsSync(path.join(electronDir, 'dist', getPlatformPath()));
}

function runInstallJs(electronDir) {
  const env = {
    ...process.env,
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || DEFAULT_MIRROR,
  };
  const result = spawnSync(process.execPath, ['install.js'], {
    cwd: electronDir,
    stdio: 'inherit',
    env,
  });
  return result.status === 0 && isInstalled(electronDir);
}

function downloadZip(electronDir) {
  const electronRequire = createRequire(path.join(electronDir, 'package.json'));
  const { downloadArtifact } = electronRequire('@electron/get');
  const { version } = electronRequire('./package.json');
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;

  return downloadArtifact({
    version,
    artifactName: 'electron',
    force: process.env.force_no_cache === 'true',
    cacheRoot: process.env.electron_config_cache,
    checksums:
      process.env.electron_use_remote_checksums ||
      process.env.npm_config_electron_use_remote_checksums
        ? undefined
        : electronRequire('./checksums.json'),
    platform,
    arch,
  });
}

function extractOnWindows(electronDir, zipPath) {
  const distPath = path.join(electronDir, 'dist');
  fs.rmSync(distPath, { recursive: true, force: true });
  fs.mkdirSync(distPath, { recursive: true });

  const psZip = zipPath.replace(/'/g, "''");
  const psDist = distPath.replace(/'/g, "''");
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${psZip}' -DestinationPath '${psDist}' -Force`,
    ],
    { stdio: 'inherit' },
  );

  if (result.status !== 0) {
    throw new Error('Expand-Archive failed while repairing Electron binary');
  }

  fs.writeFileSync(path.join(electronDir, 'path.txt'), getPlatformPath());
}

async function repairElectron() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) return;

  const electronDir = getElectronDir();
  if (isInstalled(electronDir)) return;

  console.log('[ensure-electron] Electron binary missing or incomplete, repairing...');

  if (runInstallJs(electronDir)) {
    console.log('[ensure-electron] Electron binary installed via install.js');
    return;
  }

  if (process.platform === 'win32') {
    const zipPath = await downloadZip(electronDir);
    extractOnWindows(electronDir, zipPath);
    if (!isInstalled(electronDir)) {
      throw new Error('Electron repair failed after Windows fallback extract');
    }
    console.log('[ensure-electron] Electron binary repaired via Windows fallback');
    return;
  }

  throw new Error(
    'Electron install failed. Try: pnpm rebuild electron, or set ELECTRON_MIRROR and rerun install.js',
  );
}

repairElectron().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
