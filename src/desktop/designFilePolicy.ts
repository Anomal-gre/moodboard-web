const NATIVE_DESIGN_EXTENSIONS = new Set([
  'dwg', 'dxf', 'skp', '3dm', 'rvt', 'ifc', 'pln', 'vwx', 'step', 'stp', 'iges', 'igs',
  'psd', 'psb', 'ai', 'indd', 'idml', 'blend', 'max', 'fbx', 'obj', 'mtl', 'dgn',
]);

export function nativeDesignFileName(name: string): string | null {
  const fileName = name.split(/[\\/]/).pop()?.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim();
  if (!fileName || fileName.length > 180) return null;
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase();
  if (!extension || !NATIVE_DESIGN_EXTENSIONS.has(extension)) return null;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(fileName)) return `mosa-${fileName}`;
  return fileName;
}

export const MAX_NATIVE_FILE_BYTES = 64 * 1024 * 1024;
