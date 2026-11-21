import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

const root = new URL('../mosa-clipper/', import.meta.url);
const downloads = new URL('../public/downloads/', import.meta.url);
const archive = new URL('mosa-clipper.zip', downloads);
const files = {};

async function collect(directory, prefix) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name === b.name ? 0 : 1);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const location = new URL(encodeURIComponent(entry.name) + (entry.isDirectory() ? '/' : ''), directory);
    const path = prefix + entry.name;
    if (entry.isDirectory()) await collect(location, path + '/');
    else if (entry.isFile()) {
      const bytes = await readFile(location);
      files[path] = /\.(js|json|html|css|md)$/i.test(path)
        ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes;
    }
  }
}

await collect(root, 'mosa-clipper/');
const zip = Buffer.from(zipSync(files, { level: 6, mtime: new Date(2024, 0, 1) }));
const previous = await readFile(archive).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
if (!previous?.equals(zip)) {
  await mkdir(downloads, { recursive: true });
  await writeFile(archive, zip);
}
