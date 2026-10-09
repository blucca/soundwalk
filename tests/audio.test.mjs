import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, resampleMono, summarizeScores } from '../web/audio.mjs';

test('mono preparation averages channels and owns its output buffer', () => {
  const left = new Float32Array([1, 0.5, -1, 0]);
  const right = new Float32Array([-1, 0.5, 1, 0]);
  const result = resampleMono([left, right], 16000);
  assert.deepEqual(Array.from(result), [0, 0.5, 0, 0]);
  result[0] = 0.5;
  assert.equal(left[0], 1);
  assert.equal(right[0], -1);
});

test('44.1 and 48 kHz five-second recordings yield 80,000 finite samples', () => {
  for (const rate of [44100, 48000]) {
    const channel = new Float32Array(rate * 5).fill(0.25);
    const result = resampleMono([channel], rate);
    assert.equal(result.length, 80000);
    assert.ok(result.every(sample => Number.isFinite(sample) && Math.abs(sample - 0.25) < 1e-5));
  }
});

test('downsampling preserves an audible tone and attenuates high-frequency aliases', () => {
  const rate = 48000;
  const resampledTone = frequency => resampleMono([
    Float32Array.from({ length: rate / 10 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * frequency * i / rate))
  ], rate);
  const rms = samples => {
    const interior = samples.subarray(40, -40);
    return Math.sqrt(interior.reduce((sum, value) => sum + value * value, 0) / interior.length);
  };
  const audible = rms(resampledTone(1000));
  const alias = rms(resampledTone(12000));
  assert.ok(Math.abs(audible - Math.SQRT1_2 / 2) < 0.005, `Audible RMS ${audible}`);
  assert.ok(alias < 0.005, `Alias RMS ${alias}`);
});

test('audio input validation and nonfinite samples have explicit behavior', () => {
  assert.throws(() => resampleMono([], 16000), TypeError);
  assert.throws(() => resampleMono([new Float32Array(1)], 0), RangeError);
  assert.throws(() => resampleMono([new Float32Array(1), new Float32Array(2)], 16000), RangeError);
  assert.equal(resampleMono([new Float32Array()], 48000).length, 0);
  assert.deepEqual(Array.from(resampleMono([new Float32Array([NaN, Infinity, 2, -2])], 16000)), [0, 0, 1, -1]);
});

test('sea-wave hierarchy yields water first and keeps original model evidence', () => {
  const labels = ['Ocean', 'Waves, surf', 'Water', 'Wind', 'Vehicle', 'Ship'];
  const scores = [0.7212, 0.6758, 0.6626, 0.2060, 0.1012, 0.1218];
  const { top, suggestions } = summarizeScores(scores, labels);
  assert.equal(top.length, 5);
  assert.deepEqual(top[0], { label: 'Ocean', score: 0.7212 });
  assert.deepEqual(suggestions.map(suggestion => suggestion.id), ['water']);
  assert.equal(suggestions[0].score, 0.7212);
  assert.deepEqual(suggestions[0].evidence.map(entry => entry.label), ['Ocean', 'Waves, surf', 'Water']);
});

test('mixed scenes produce at most three relevant user choices', () => {
  const { suggestions } = summarizeScores(
    [0.6, 0.4, 0.35, 0.28, 0.16],
    ['Bird', 'Wind', 'Traffic noise, roadway noise', 'Speech', 'Water']
  );
  assert.deepEqual(suggestions.map(suggestion => suggestion.id), ['birds', 'wind', 'city']);
  assert.ok(suggestions.every(suggestion => GROUPS[suggestion.id]));
});

test('quiet, weak, and ungrouped scenes keep the open-ear invitation', () => {
  for (const [scores, labels] of [
    [[0.9, 0.3], ['Silence', 'Bird']],
    [[0.05, 0.02], ['Bird', 'Rain']],
    [[0.9, 0.2], ['Sine wave', 'Bird']],
    [[NaN, -2], ['Bird', 'Wind']],
    [[], []]
  ]) {
    const { suggestions } = summarizeScores(scores, labels);
    assert.deepEqual(suggestions, [{ id: 'other', name: GROUPS.other.name, score: 0, evidence: [] }]);
  }
  assert.throws(() => summarizeScores([0.5], []), TypeError);
});

test('every listening choice has a concrete one-minute task and short invitation', () => {
  assert.deepEqual(Object.keys(GROUPS), ['birds', 'water', 'wind', 'city', 'life', 'other']);
  for (const group of Object.values(GROUPS)) {
    assert.match(group.prompt, /^For one minute,/);
    assert.ok(group.invitation.length < 70);
    assert.ok(group.name && group.eyebrow);
  }
});
