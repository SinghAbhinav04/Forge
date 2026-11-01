import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const headers = { 'User-Agent': 'Local-Desk/0.1', Accept: 'application/vnd.github+json' };
async function request(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}. ${response.status === 403 ? 'API rate limit may be reached; try again later or install a runtime manually.' : ''}`);
  return response;
}
export async function latestRelease() {
  let release = await (await request('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest')).json();
  if (!release.assets?.some(a => /\.(zip|tar\.gz)$/.test(a.name))) {
    const pointer = release.assets?.find(a => a.name === 'nightly-tag.txt');
    if (pointer) {
      const tag = (await (await request(pointer.browser_download_url)).text()).trim();
      if (!/^[a-zA-Z0-9._-]+$/.test(tag)) throw new Error('Unexpected upstream release tag.');
      release = await (await request(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${tag}`)).json();
    } else {
      const releases = await (await request('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10')).json();
      release = releases.find(r => r.assets?.some(a => /bin-.*\.(zip|tar\.gz)$/.test(a.name)));
    }
  }
  if (!release?.assets?.length) throw new Error('No prebuilt llama.cpp release found. Choose a llama-server executable manually.');
  return release;
}
export function chooseAsset(assets, platform, arch, backend) {
  if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error(`Automatic installation is unavailable for ${platform}/${arch}. Choose your own llama-server in Settings.`);
  const cpuArch = arch === 'arm64' ? '(?:arm64|aarch64)' : '(?:x64|x86_64)';
  const os = platform === 'win32' ? 'win(?:dows)?' : platform === 'darwin' ? '(?:macos|darwin)' : '(?:ubuntu|linux)';
  const cudaVersion=platform==='win32' ? arch==='arm64' ? '13\\.4' : '12\\.4' : arch==='arm64' ? '13\\.4' : '12\\.8';
  const engine=backend==='cuda' ? `cuda-${cudaVersion}-` : backend==='vulkan' ? 'vulkan-' : platform==='win32' ? 'cpu-' : '(?:cpu-)?';
  const pattern = new RegExp(`^llama-.+-bin-${os}-${engine}${cpuArch}\\.(?:zip|tar\\.gz)$`, 'i');
  const asset = assets.find(a => pattern.test(a.name));
  if (!asset) throw new Error(`No ${backend} runtime is published for ${platform}/${arch} in this release. Install a compatible llama-server manually.`);
  return asset;
}
async function findBinary(dir) {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && entry.name === name) return path.join(dir, name);
    if (entry.isDirectory()) { const found = await findBinary(path.join(dir, entry.name)); if (found) return found; }
  }
  return null;
}
const extract = (archive, directory) => new Promise((resolve, reject) => {
  // Windows includes bsdtar; macOS/Linux use system tar for .tar.gz archives.
  const child = spawn('tar', ['-xf', archive, '-C', directory], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let error = ''; child.stderr.on('data', chunk => { error += chunk; }); child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Archive extraction failed: ${error.slice(0, 1500)}`)));
});
export async function installRuntime({ directory = path.join(appRoot, 'runtime'), backend = 'cpu', log = console.log } = {}) {
  if (!['cpu','vulkan','cuda'].includes(backend)) throw new Error('Select cpu, vulkan or cuda.');
  const release = await latestRelease();
  const asset = chooseAsset(release.assets, process.platform, process.arch, backend);
  if (!asset.browser_download_url.startsWith('https://github.com/ggml-org/llama.cpp/releases/download/')) throw new Error('Unexpected runtime download URL.');
  log(`Release ${release.tag_name} · ${asset.name} · ${(asset.size / 1024 ** 2).toFixed(1)} MiB`);
  const root = path.resolve(directory); await fs.mkdir(root, { recursive: true });
  const staging = path.join(root, `.install-${randomUUID()}`); await fs.mkdir(staging);
  try {
    const archive = path.join(staging, asset.name);
    log('Downloading official llama.cpp binary…');
    const response = await request(asset.browser_download_url);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }));
    const sha = createHash('sha256'); for await (const chunk of createReadStream(archive)) sha.update(chunk);
    const digest = `sha256:${sha.digest('hex')}`;
    if (!asset.digest) throw new Error('GitHub did not publish a checksum. Install a verified runtime manually.');
    if (digest !== asset.digest) throw new Error('Downloaded archive checksum does not match GitHub.');
    log('Checksum verified. Extracting…');
    const output = path.join(staging, 'files'); await fs.mkdir(output); await extract(archive, output);
    if (backend==='cuda') {
      const suffix=asset.name.match(/bin-(.+)$/)?.[1]; const dependency=release.assets.find(a => a.name.startsWith('cudart-') && a.name.endsWith(`bin-${suffix}`));
      if (!dependency?.digest || !dependency.browser_download_url.startsWith('https://github.com/ggml-org/llama.cpp/releases/download/')) throw new Error('Matching CUDA runtime dependency archive was not found.');
      log(`Downloading CUDA dependencies · ${(dependency.size/1024**2).toFixed(1)} MiB…`); const dependencyArchive=path.join(staging,dependency.name); await pipeline(Readable.fromWeb((await request(dependency.browser_download_url)).body),createWriteStream(dependencyArchive,{ flags:'wx' })); const dependencyHash=createHash('sha256'); for await (const chunk of createReadStream(dependencyArchive)) dependencyHash.update(chunk); if (`sha256:${dependencyHash.digest('hex')}`!==dependency.digest) throw new Error('CUDA dependency checksum mismatch.'); await extract(dependencyArchive,output);
    }
    const binary = await findBinary(output); if (!binary) throw new Error('Archive did not contain llama-server.');
    const installed = path.join(root, `${release.tag_name}-${backend}-${randomUUID().slice(0, 8)}`);
    const relative = path.relative(output, binary); await fs.rename(output, installed);
    const executable = path.join(installed, relative);
    await fs.writeFile(path.join(installed,'install.json'),JSON.stringify({ executable:relative,tag:release.tag_name,backend,digest },null,2));
    if (process.platform !== 'win32') await fs.chmod(executable, 0o755);
    await fs.writeFile(path.join(root, 'current.json'), JSON.stringify({ executable: path.relative(root, executable), tag: release.tag_name, backend, asset: asset.name, digest }, null, 2));
    log(`Installed: ${executable}`); return executable;
  } finally {
    const relative = path.relative(root, staging);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.rm(staging, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--list')) { const release = await latestRelease(); console.log(JSON.stringify({ tag: release.tag_name, assets: release.assets.map(a => ({ name: a.name, size: a.size, digest: a.digest })) }, null, 2)); }
    else await installRuntime({ backend:process.argv.includes('--backend=cuda') ? 'cuda' : process.argv.includes('--backend=vulkan') ? 'vulkan' : 'cpu' });
  } catch (error) { console.error(`Runtime setup failed: ${error.message}`); process.exitCode = 1; }
}
