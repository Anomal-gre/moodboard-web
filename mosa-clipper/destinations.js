const MOSA_LOCAL_ORIGINS = ['http://127.0.0.1:4313', 'http://localhost:4313'];
const DEFAULT_DEPLOYED_MOSA_URL = 'https://anomal-gre.github.io/moodboard-web/';
const MOSA_CUSTOM_DOMAIN_URL = 'https://mosa.ohwow.win/';
const MOSA_BRIDGE_VERSION = 2;

function normalizeMosaUrl(value) {
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return url.origin + url.pathname.replace(/(?:\/index\.html|\/+)?$/, '') + '/';
  } catch {
    return '';
  }
}

function trustedMosaUrl(value, customUrl) {
  try {
    const url = new URL(value);
    const normalized = normalizeMosaUrl(url.origin + url.pathname);
    const allowed = [MOSA_CUSTOM_DOMAIN_URL, DEFAULT_DEPLOYED_MOSA_URL, ...MOSA_LOCAL_ORIGINS.map((base) => base + '/')];
    const custom = normalizeMosaUrl(customUrl);
    if (custom) allowed.push(custom);
    return allowed.includes(normalized) ? normalized : '';
  } catch {
    return '';
  }
}

function isMosaProjectId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_\-]{1,96}$/.test(value);
}

function readMosaDestination(value) {
  if (!value || !isMosaProjectId(value.projectId) || typeof value.projectName !== 'string') return null;
  return { projectId: value.projectId, projectName: value.projectName.slice(0, 180) };
}
