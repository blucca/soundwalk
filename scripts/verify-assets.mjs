// The deployed application includes the complete, licensed local AI path.
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const provenance = JSON.parse(await readFile(resolve(root, 'model/provenance.json'), 'utf8'));
let totalBytes = 0;
for (const asset of provenance.files) {
  const path = resolve(root, asset.path);
  assert(path.startsWith(root), `Asset path stays inside web/: ${asset.path}`);
  const bytes = await readFile(path);
  assert.equal(bytes.length, asset.bytes, `${asset.path}: byte length`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `${asset.path}: original bytes`);
  assert(asset.source && asset.license, `${asset.path}: provenance and license`);
  totalBytes += bytes.length;
}
const graph = JSON.parse(await readFile(resolve(root, 'model/model.json'), 'utf8'));
const labels = JSON.parse(await readFile(resolve(root, 'model/labels.json'), 'utf8'));
assert.equal(labels.length, 521, 'YAMNet label count');
for (const group of graph.weightsManifest) {
  for (const path of group.paths) {
    assert(provenance.files.some(asset => asset.path === `model/${path}`), `Manifest shard has provenance: ${path}`);
  }
}
const sw = await readFile(resolve(root, 'sw.js'), 'utf8');
const paths = [...sw.matchAll(/'\.\/([^']*)'/g)].map(match => match[1]).filter(Boolean);
for (const path of new Set(paths)) {
  assert(!path.includes('..' + sep), 'Offline asset stays in web/');
  assert((await stat(resolve(root, path))).isFile(), `Offline asset exists: ${path}`);
}
for (const file of ['app.mjs', 'styles.css', 'audio.mjs', 'model-worker.js', 'recorder-worklet.js', 'vendor/tf.min.js', 'model/model.json', 'model/labels.json', 'audio/sea-waves.wav']) {
  assert(paths.includes(file), `Offline dependency is packed: ${file}`);
}
console.log(JSON.stringify({ ok: true, provenanceAssets: provenance.files.length, verifiedBytes: totalBytes, labels: labels.length, offlineAssets: new Set(paths).size }, null, 2));
