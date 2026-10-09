/* SoundWalk local YAMNet worker. Application code: MIT license. */
'use strict';

let modelState;
let initialization;
let inferenceQueue = Promise.resolve();
const SAMPLE_COUNT = 5 * 16000;

function progress(id, amount, message) {
  self.postMessage({ type: 'progress', id, progress: Math.max(0, Math.min(1, amount)), message });
}

async function initialize(id) {
  if (modelState) return modelState;
  if (initialization) return initialization;
  initialization = (async () => {
    progress(id, 0, 'Preparing the on-device sound model…');
    if (!self.tf) importScripts('./vendor/tf.min.js');
    await self.tf.setBackend('cpu');
    await self.tf.ready();
    progress(id, 0.05, 'Loading sound labels…');
    const [audio, response] = await Promise.all([
      import('./audio.mjs'),
      fetch('./model/labels.json')
    ]);
    if (!response.ok) throw new Error(`Sound labels download failed (${response.status}).`);
    const labels = await response.json();
    if (!Array.isArray(labels) || labels.length !== 521 ||
        labels.some(label => typeof label !== 'string')) {
      throw new Error('The sound label file needs a fresh download.');
    }
    progress(id, 0.1, 'Loading the local model (16.1 MB)…');
    const graph = await self.tf.loadGraphModel('./model/model.json', {
      onProgress: amount => progress(id, 0.1 + 0.85 * amount, 'Loading the local sound model…')
    });
    modelState = { graph, labels, summarizeScores: audio.summarizeScores };
    progress(id, 1, 'Sound model ready on this device.');
    return modelState;
  })();
  try {
    return await initialization;
  } catch (error) {
    initialization = undefined;
    throw error;
  }
}

async function analyze(id, input) {
  if (!(input instanceof Float32Array) || input.length === 0) {
    throw new TypeError('Send a Float32Array of mono audio at 16 kHz.');
  }
  const { graph, labels, summarizeScores } = await initialize(id);
  const samples = new Float32Array(SAMPLE_COUNT);
  for (let i = 0; i < Math.min(input.length, SAMPLE_COUNT); i++) {
    const sample = Number.isFinite(input[i]) ? input[i] : 0;
    samples[i] = Math.max(-1, Math.min(1, sample));
  }

  let waveform;
  let outputs;
  let meanScores;
  const startedAt = performance.now();
  try {
    waveform = self.tf.tensor1d(samples, 'float32');
    outputs = await graph.executeAsync(waveform);
    const tensors = Array.isArray(outputs) ? outputs : Object.values(outputs);
    const scores = tensors.find(tensor => tensor.shape.length === 2 && tensor.shape[1] === labels.length);
    if (!scores) throw new Error('The sound model returned an unexpected output shape.');
    meanScores = scores.mean(0);
    const values = await meanScores.data();
    const summary = summarizeScores(values, labels);
    self.postMessage({
      type: 'result', id, ...summary,
      inferenceMs: Math.round(performance.now() - startedAt),
      samples: samples.length,
      backend: self.tf.getBackend()
    });
  } finally {
    // The graph's weights stay ready for the next five-second recording.
    // Per-recording waveform, all three YAMNet outputs, and mean are released.
    self.tf.dispose([waveform, outputs, meanScores]);
  }
}

function fail(id, error) {
  self.postMessage({ type: 'error', id, message: error?.message || 'Local sound analysis failed. Please try again.' });
}

self.addEventListener('message', ({ data }) => {
  const { type, id, samples } = data || {};
  if (type === 'init') {
    initialize(id).then(() => self.postMessage({ type: 'ready', id })).catch(error => fail(id, error));
    return;
  }
  if (type === 'analyze') {
    // Serial execution bounds working memory when messages arrive together.
    inferenceQueue = inferenceQueue.then(() => analyze(id, samples)).catch(error => fail(id, error));
    return;
  }
  fail(id, new Error('Use init or analyze for the local sound worker.'));
});
