import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const json = (file) => JSON.parse(read(file));
const versionOf = (section) => section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const version = json('package.json').version;
const npmLock = json('package-lock.json');
const cargoPackage = read('src-tauri/Cargo.toml').split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
const cargoPackages = read('src-tauri/Cargo.lock').split(/^\[\[package\]\]\s*$/m)
  .filter((section) => /^name\s*=\s*"mao-map"\s*$/m.test(section));
const versions = [
  ['package.json', version],
  ['package-lock.json', npmLock.version],
  ['package-lock.json root package', npmLock.packages?.['']?.version],
  ['version.json', json('version.json').version],
  ['src-tauri/tauri.conf.json', json('src-tauri/tauri.conf.json').version],
  ['src-tauri/Cargo.toml', versionOf(cargoPackage)],
  ['src-tauri/Cargo.lock root package', cargoPackages.length === 1 ? versionOf(cargoPackages[0]) : undefined],
  ['src/tauri-titlebar.js', read('src/tauri-titlebar.js').match(/\bconst APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1]],
];

const errors = [];
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(version)) {
  errors.push('package.json must declare a valid application version.');
}
for (const [file, actual] of versions) {
  if (actual !== version) errors.push(`${file}: expected ${version}, found ${actual ?? 'no version'}.`);
}
const tag = process.argv[2] || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
if (tag && tag !== `v${version}`) errors.push(`Release tag ${tag} does not match application version v${version}.`);

if (errors.length) {
  errors.forEach((error) => console.error(error));
  process.exitCode = 1;
} else {
  console.log(`Application version ${version} is consistent across ${versions.length} declarations${tag ? ` and tag ${tag}` : ''}.`);
}
