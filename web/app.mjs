import { GROUPS, resampleMono } from './audio.mjs';

const $ = id => document.getElementById(id);
const SYMBOLS = { birds: '⌁', water: '≈', wind: '〰', city: '↗', life: '♪', other: '✳' };
const CARD_KEY = 'soundwalk.cards.v1';
const MINUTE_MS = 60_000;
const state = { mode: 'microphone', analysis: null, group: 'other', capturedAt: null, duration: 0, currentCard: null };
let currentView = 'home';
let flowVersion = 0;
let cards = readCards();
let soundWorker;
let modelReady = false;
let requestNumber = 0;
const requests = new Map();
let activeCapture;
let timer;
let wakeLock;
let chimeContext;
let sampleObjectUrl;
let retry = () => prepare(state.mode);
let messageTimeout;

function notify(message) {
  clearTimeout(messageTimeout);
  $('message').textContent = message;
  $('message').hidden = false;
  messageTimeout = setTimeout(() => { $('message').hidden = true; }, 9000);
}

function setView(view) {
  currentView = view;
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${view}`;
  document.body.classList.toggle('listening', view === 'listen');
  $('message').hidden = true;
  window.scrollTo({ top: 0, behavior: 'instant' });
  $(`view-${view}`).querySelector('[tabindex="-1"]')?.focus({ preventScroll: true });
}

function sourceLabel(mode = state.mode) {
  return mode === 'sample' ? 'LICENSED SAMPLE · SEA WAVES' : mode === 'microphone' ? 'FIVE-SECOND MICROPHONE LISTEN' : 'SELF-CHOSEN LISTENING INVITATION';
}

function setSource(element, mode = state.mode) {
  element.textContent = sourceLabel(mode);
  element.classList.toggle('sample', mode === 'sample');
}

function requestWorker(type, extra = {}, transfer = []) {
  if (!soundWorker) {
    soundWorker = new Worker(new URL('./model-worker.js', import.meta.url));
    soundWorker.addEventListener('message', ({ data }) => {
      const pending = requests.get(data.id);
      if (!pending) return;
      if (data.type === 'progress') {
        if (currentView === 'prepare') {
          $('model-progress').value = data.progress;
          $('prepare-status').textContent = data.message;
        }
        return;
      }
      clearTimeout(pending.timeout);
      requests.delete(data.id);
      if (data.type === 'error') pending.reject(new Error(data.message));
      else pending.resolve(data);
    });
    soundWorker.addEventListener('error', () => {
      for (const request of requests.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error('The local sound model stopped. Try loading it again.'));
      }
      requests.clear();
      soundWorker.terminate();
      soundWorker = undefined;
      modelReady = false;
    });
  }
  const id = ++requestNumber;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      requests.delete(id);
      reject(new Error('The model is taking a little longer. Check your connection and try again.'));
    }, 150_000);
    requests.set(id, { resolve, reject, timeout });
    soundWorker.postMessage({ type, id, ...extra }, transfer);
  });
}

function serviceMessage(service, type, onProgress) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Offline preparation timed out.')); }, 120_000);
    channel.port1.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress?.(data); return; }
      clearTimeout(timeout);
      channel.port1.close();
      if (data.type === 'error') reject(new Error(data.message));
      else resolve(data);
    };
    service.postMessage({ type }, [channel.port2]);
  });
}

const serviceReady = (async () => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    const ready = await Promise.race([navigator.serviceWorker.ready, new Promise(resolve => setTimeout(() => resolve(null), 6000))]);
    if (!ready || !registration.active) return null;
    const status = await serviceMessage(registration.active, 'STATUS');
    if (status.ready) $('offline-status').textContent = 'READY FOR AN OFFLINE SOUNDWALK';
    return registration;
  } catch { return null; }
})();

async function warmOffline(registration) {
  if (!registration?.active) return;
  try {
    const result = await serviceMessage(registration.active, 'WARM_CACHE', data => {
      $('prepare-status').textContent = 'Packing the sound model for offline walks…';
      $('model-progress').value = data.completed / data.total;
    });
    if (result.ready) $('offline-status').textContent = 'READY FOR AN OFFLINE SOUNDWALK';
  } catch {
    $('offline-status').textContent = 'LOCAL MODEL READY · ONLINE CACHE PENDING';
  }
}

function showError(message, next) {
  $('error-copy').textContent = message;
  retry = next;
  setView('error');
}

async function prepare(mode) {
  const flow = ++flowVersion;
  state.mode = mode;
  state.analysis = null;
  state.duration = 0;
  state.capturedAt = null;
  $('prepare-eyebrow').textContent = mode === 'sample' ? 'A SHORELINE REHEARSAL' : 'PACKING LIGHT';
  $('prepare-title').innerHTML = 'A little preparation.<br><em>A whole world outside.</em>';
  $('prepare-copy').textContent = mode === 'sample' ? 'This rehearsal uses a credited shoreline recording. The open-source sound model runs on this device.' : 'Bringing the open-source sound model to your device. Your microphone opens when you choose Record.';
  $('prepare-status').textContent = modelReady ? 'Your local sound model is ready.' : 'Preparing local listening…';
  $('model-progress').value = modelReady ? 1 : 0;
  setView('prepare');
  try {
    const registration = await serviceReady;
    if (!modelReady) {
      await requestWorker('init');
      modelReady = true;
    }
    if (flow !== flowVersion) return;
    await warmOffline(registration);
    if (flow !== flowVersion) return;
    if (mode === 'sample') await analyzeSample(flow);
    else showRecord();
  } catch (error) {
    if (flow === flowVersion) showError(error.message, () => prepare(mode));
  }
}

function showRecord() {
  state.mode = 'microphone';
  $('record-number').textContent = '5';
  $('record-status').textContent = 'Ready when you are.';
  $('record-button').disabled = false;
  $('record-button').hidden = false;
  $('cancel-record').hidden = true;
  $('record-orbit').classList.remove('recording');
  setView('record');
}

async function analyze(samples, flow = flowVersion) {
  $('prepare-eyebrow').textContent = state.mode === 'sample' ? 'LICENSED SEA-WAVE SAMPLE' : 'FIVE SECONDS, ON YOUR DEVICE';
  $('prepare-title').innerHTML = 'Finding a<br><em>starting point.</em>';
  $('prepare-copy').textContent = 'YAMNet is matching the sound to broad categories. Your listening invitation comes next.';
  $('prepare-status').textContent = 'Listening locally with the CPU…';
  $('model-progress').removeAttribute('value');
  setView('prepare');
  state.analysis = await requestWorker('analyze', { samples }, [samples.buffer]);
  if (flow === flowVersion) renderChoices();
}

async function analyzeSample(flow = flowVersion) {
  const response = await fetch('./audio/sea-waves.wav');
  if (!response.ok) throw new Error('The sample download failed. Try the shoreline again.');
  const bytes = await response.arrayBuffer();
  if (flow !== flowVersion) return;
  // A complete local Blob gives native playback the same bytes used for inference.
  // It also keeps the rehearsal independent of HTTP byte-range handling offline.
  if (sampleObjectUrl) URL.revokeObjectURL(sampleObjectUrl);
  sampleObjectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  $('sample-audio').src = sampleObjectUrl;
  $('sample-audio').load();
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const context = new OfflineContext(1, 1, 16_000);
  const buffer = await context.decodeAudioData(bytes);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const samples = resampleMono(channels, buffer.sampleRate);
  state.capturedAt = new Date().toISOString();
  if (flow === flowVersion) await analyze(samples, flow);
}

function captureFiveSeconds() {
  return new Promise((resolve, reject) => {
    const handle = { finished: false, chunks: [], count: 0 };
    activeCapture = handle;
    handle.finish = (error, samples) => {
      if (handle.finished) return;
      handle.finished = true;
      clearTimeout(handle.timeout);
      handle.stream?.getTracks().forEach(track => track.stop());
      handle.source?.disconnect();
      handle.node?.disconnect();
      handle.silent?.disconnect();
      if (handle.node) handle.node.port.onmessage = null;
      handle.context?.close().catch(() => {});
      handle.chunks = [];
      if (activeCapture === handle) activeCapture = undefined;
      if (error) reject(error);
      else resolve(samples);
    };
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture needs HTTPS and a current browser. You can also try the shoreline sample.');
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      handle.context = new AudioContext();
      await handle.context.resume();
      $('record-status').textContent = 'Allow microphone access to catch five seconds.';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (handle.finished) { stream.getTracks().forEach(track => track.stop()); return; }
      handle.stream = stream;
      await handle.context.audioWorklet.addModule('./recorder-worklet.js');
      if (handle.finished) return;
      handle.source = handle.context.createMediaStreamSource(stream);
      handle.node = new AudioWorkletNode(handle.context, 'soundwalk-recorder');
      handle.silent = handle.context.createGain();
      handle.silent.gain.value = 0;
      const target = Math.round(handle.context.sampleRate * 5);
      handle.node.port.onmessage = ({ data }) => {
        if (handle.finished) return;
        handle.chunks.push(data);
        handle.count += data.length;
        $('record-number').textContent = String(Math.max(0, Math.ceil((target - handle.count) / handle.context.sampleRate)));
        if (handle.count >= target) {
          const pcm = new Float32Array(target);
          let offset = 0;
          for (const chunk of handle.chunks) {
            const length = Math.min(chunk.length, target - offset);
            pcm.set(chunk.subarray(0, length), offset);
            offset += length;
            if (offset >= target) break;
          }
          const sampleRate = handle.context.sampleRate;
          handle.finish(null, { pcm, sampleRate });
        }
      };
      handle.source.connect(handle.node);
      handle.node.connect(handle.silent);
      handle.silent.connect(handle.context.destination);
      $('record-status').textContent = 'Let the world do the talking.';
      $('record-orbit').classList.add('recording');
      handle.timeout = setTimeout(() => handle.finish(new Error('Audio capture stopped. Keep this tab open and record again.')), 12_000);
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => handle.finish(new Error('The microphone stopped. Record again when you are ready.')), { once: true });
    })().catch(error => handle.finish(error));
  });
}

async function record() {
  if (activeCapture) return;
  const flow = ++flowVersion;
  $('record-button').disabled = true;
  $('cancel-record').hidden = false;
  state.mode = 'microphone';
  try {
    const { pcm, sampleRate } = await captureFiveSeconds();
    state.capturedAt = new Date().toISOString();
    const samples = resampleMono([pcm], sampleRate);
    if (flow === flowVersion) await analyze(samples, flow);
  } catch (error) {
    if (flow !== flowVersion) return;
    showRecord();
    const message = error.name === 'NotAllowedError' ? 'Microphone access is paused. Enable it in this site’s browser settings and try again, or open the shoreline sample from Home.' : error.name === 'NotFoundError' ? 'Connect a microphone to record. The shoreline sample is also available from Home.' : error.message;
    $('record-status').textContent = message;
  } finally {
    $('record-button').disabled = false;
    $('cancel-record').hidden = true;
    $('record-orbit').classList.remove('recording');
  }
}

function renderChoices() {
  const suggestions = state.analysis?.suggestions || [];
  const suggested = new Set(suggestions.filter(item => item.id !== 'other' && item.score > 0).map(item => item.id));
  const order = [...new Set([...suggested, ...Object.keys(GROUPS)])];
  const holder = $('sound-choices');
  holder.replaceChildren();
  for (const id of order) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sound-choice${suggested.has(id) ? ' suggested' : ''}`;
    button.dataset.group = id;
    const symbol = document.createElement('span');
    symbol.className = 'symbol'; symbol.textContent = SYMBOLS[id]; symbol.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong'); name.textContent = GROUPS[id].name;
    const label = document.createElement('small'); label.textContent = suggested.has(id) ? 'MODEL SUGGESTION' : id === 'other' ? 'LET YOUR EARS CHOOSE' : 'FOLLOW THIS SOUND';
    button.append(symbol, name, label);
    button.addEventListener('click', () => chooseGroup(id));
    holder.append(button);
  }
  setSource($('choose-source'));
  $('choose-copy').textContent = suggested.size ? 'The model offers a starting point. You choose the sound to follow.' : 'An open invitation: choose a sound you noticed, or follow your nearest and farthest sounds.';
  $('model-details').hidden = !state.analysis;
  $('model-details').open = false;
  $('model-labels').replaceChildren();
  for (const item of state.analysis?.top || []) {
    const row = document.createElement('li');
    const label = document.createElement('span'); label.textContent = item.label;
    const score = document.createElement('span'); score.textContent = item.score.toFixed(3);
    row.append(label, score); $('model-labels').append(row);
  }
  if (state.analysis) $('inference-details').textContent = `80,000 samples · mono 16 kHz · ${(state.analysis.inferenceMs / 1000).toFixed(2)} seconds of local CPU inference.`;
  $('record-again').textContent = state.mode === 'sample' ? 'Try my own surroundings' : 'Catch another sound';
  setView('choose');
}

function chooseGroup(id) {
  state.group = id;
  const group = GROUPS[id];
  $('task-symbol').textContent = SYMBOLS[id];
  $('task-title').textContent = group.eyebrow;
  $('task-prompt').textContent = group.prompt;
  $('task-eyebrow').textContent = `02 / ${group.name.toUpperCase()}`;
  setSource($('task-source'));
  $('sample-explanation').hidden = state.mode !== 'sample';
  setView('task');
}

async function acquireWakeLock() {
  if (!navigator.wakeLock || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* Foreground timing also works with the browser's normal screen policy. */ }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function initializeChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!chimeContext || chimeContext.state === 'closed') chimeContext = new AudioContext();
    chimeContext.resume().catch(() => {});
  } catch { /* The completed page is also the visual end-of-minute cue. */ }
}

function chime() {
  if (!chimeContext || chimeContext.state !== 'running') return;
  for (const [delay, frequency] of [[0, 660], [0.2, 880]]) {
    const oscillator = chimeContext.createOscillator();
    const gain = chimeContext.createGain();
    const at = chimeContext.currentTime + delay;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.07, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
    oscillator.connect(gain); gain.connect(chimeContext.destination);
    oscillator.start(at); oscillator.stop(at + 0.65);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}

function elapsed() {
  return timer ? Math.min(MINUTE_MS, timer.elapsedMs + (timer.paused ? 0 : performance.now() - timer.startedAt)) : 0;
}

function tick() {
  if (!timer) return;
  const progress = elapsed();
  const seconds = Math.ceil((MINUTE_MS - progress) / 1000);
  $('time-left').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('clock-progress').style.strokeDashoffset = String(515.222 * progress / MINUTE_MS);
  if (progress >= MINUTE_MS) finishMinute(true);
}

function playSample() {
  const activeTimer = timer;
  $('sample-audio').play().catch(() => {
    if (!timer || timer !== activeTimer || timer.paused) return;
    pauseMinute();
    $('listen-hint').textContent = 'Shoreline audio failed. Tap Resume to try again.';
  });
}

function startMinute() {
  initializeChime();
  timer = { startedAt: performance.now(), elapsedMs: 0, paused: false, interval: null };
  $('listen-source').textContent = state.mode === 'sample' ? 'SAMPLE REHEARSAL · SEA WAVES' : 'YOUR MINUTE OF ATTENTION';
  $('listen-kind').textContent = GROUPS[state.group].name.toUpperCase();
  $('listen-prompt').textContent = GROUPS[state.group].invitation;
  $('listen-hint').textContent = state.mode === 'sample' ? 'The licensed shoreline clip is looping for this rehearsal.' : 'Your microphone is off. Just listen.';
  $('pause-button').textContent = 'Pause';
  $('finish-button').textContent = 'Finish early';
  if (state.mode === 'sample') {
    $('sample-audio').loop = true;
    $('sample-audio').currentTime = 0;
    playSample();
  }
  setView('listen');
  acquireWakeLock();
  timer.interval = setInterval(tick, 200);
  tick();
}

function pauseMinute(reason = 'manual') {
  if (!timer || timer.paused) return;
  timer.elapsedMs = elapsed();
  timer.paused = true;
  $('pause-button').textContent = 'Resume';
  $('listen-hint').textContent = reason === 'hidden' ? 'Your minute paused while this tab was away. Resume when you are ready.' : 'Take your time. Resume when you are ready.';
  $('sample-audio').pause();
  releaseWakeLock();
  tick();
}

function resumeMinute() {
  if (!timer?.paused) return;
  timer.startedAt = performance.now();
  timer.paused = false;
  $('pause-button').textContent = 'Pause';
  $('listen-hint').textContent = state.mode === 'sample' ? 'The licensed shoreline clip is looping for this rehearsal.' : 'Your microphone is off. Just listen.';
  initializeChime();
  if (state.mode === 'sample') playSample();
  acquireWakeLock();
}

function stopTimer() {
  if (timer) clearInterval(timer.interval);
  timer = null;
  $('sample-audio').pause();
  $('sample-audio').loop = false;
  releaseWakeLock();
}

function finishMinute(completed = false) {
  if (!timer) return;
  state.duration = completed ? 60 : Math.min(60, Math.floor(elapsed() / 1000));
  stopTimer();
  if (completed) chime();
  $('observation').value = '';
  $('place').value = '';
  $('character-count').textContent = '0 / 280';
  $('note-context').textContent = `${state.duration} seconds with ${GROUPS[state.group].name.toLowerCase()} · ${sourceLabel().toLowerCase()}.`;
  setView('note');
}

function readCards() {
  try {
    const stored = JSON.parse(localStorage.getItem(CARD_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter(card => typeof card.id === 'string' && typeof card.observation === 'string' && GROUPS[card.group] && Number.isFinite(card.duration)).slice(0, 50) : [];
  } catch { return []; }
}

function persistCards() {
  $('note-count').textContent = String(cards.length);
  try { localStorage.setItem(CARD_KEY, JSON.stringify(cards)); return true; } catch { return false; }
}

function dateText(date) {
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderCard(card, saved = true) {
  state.currentCard = card;
  $('card-date').textContent = dateText(card.createdAt);
  $('card-symbol').textContent = SYMBOLS[card.group];
  $('card-category').textContent = GROUPS[card.group].name.toUpperCase();
  $('card-quote').textContent = `“${card.observation}”`;
  $('card-place').textContent = card.place;
  $('card-place').hidden = !card.place;
  $('card-source').textContent = sourceLabel(card.mode);
  $('card-source').style.color = card.mode === 'sample' ? '#825126' : '';
  const suggested = card.suggestions?.filter(suggestion => suggestion.id !== 'other').map(suggestion => suggestion.name).join(', ');
  $('card-model').textContent = suggested ? `Model suggested: ${suggested}. You followed: ${GROUPS[card.group].name}.` : card.mode === 'manual' ? 'A listening invitation chosen by you.' : 'Model offered an open invitation. You chose the sound.';
  $('card-duration').textContent = `${card.duration} seconds of listening · Your own words`;
  $('save-status').textContent = saved ? 'Kept in your field notes on this device.' : 'Your card is ready. Save an image to keep it.';
  setView('card');
}

function saveCard(event) {
  event.preventDefault();
  const observation = $('observation').value.trim();
  if (!observation) { $('observation').focus(); return; }
  const card = {
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), capturedAt: state.capturedAt,
    mode: state.mode, group: state.group, duration: state.duration,
    observation, place: $('place').value.trim(),
    suggestions: state.analysis?.suggestions || [], top: state.analysis?.top || [],
    inferenceMs: state.analysis?.inferenceMs || null
  };
  cards = [card, ...cards].slice(0, 50);
  renderCard(card, persistCards());
}

function renderNotes() {
  const list = $('notes-list');
  list.replaceChildren();
  if (!cards.length) {
    const empty = document.createElement('p'); empty.className = 'notes-empty'; empty.textContent = 'Your first small discovery belongs here.'; list.append(empty);
  }
  for (const card of cards) {
    const button = document.createElement('button'); button.className = 'note-thumb';
    const kind = document.createElement('span'); kind.className = 'eyebrow'; kind.textContent = GROUPS[card.group].name;
    const quote = document.createElement('span'); quote.className = 'quote'; quote.textContent = `“${card.observation}”`;
    const source = document.createElement('small'); source.textContent = `${dateText(card.createdAt)} · ${card.mode === 'sample' ? 'Sample rehearsal' : card.mode === 'manual' ? 'Self-chosen' : 'Microphone'}`;
    button.append(kind, quote, source); button.addEventListener('click', () => renderCard(card)); list.append(button);
  }
  setView('notes');
}

function wrapCanvasText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of word) {
        if (context.measureText(line + character).width > maxWidth && line) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function downloadCard() {
  const card = state.currentCard;
  if (!card) return;
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f9f7ed'; ctx.fillRect(0, 0, 1080, 1350);
  for (let x = 0; x < 1080; x += 65) { ctx.fillStyle = x % 130 ? '#dce5bf' : '#71865a'; ctx.fillRect(x, 0, 65, 15); }
  ctx.fillStyle = '#293f34'; ctx.font = 'bold 54px Georgia'; ctx.fillText('soundwalk.', 82, 105);
  ctx.fillStyle = '#626b5c'; ctx.font = '23px "DM Sans"'; ctx.textAlign = 'right'; ctx.fillText(dateText(card.createdAt), 998, 99);
  ctx.strokeStyle = '#c1cbab'; ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(540, 287, 43 + i * 31, 68 + i * 27, -0.3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.textAlign = 'center'; ctx.fillStyle = '#627a47'; ctx.font = '58px Georgia'; ctx.fillText(SYMBOLS[card.group], 540, 305);
  ctx.font = '25px "DM Sans"'; ctx.fillStyle = '#485d3a'; ctx.fillText(GROUPS[card.group].name.toUpperCase(), 540, 468);
  let size = 64; let lines;
  do { ctx.font = `${size}px Georgia`; lines = wrapCanvasText(ctx, `“${card.observation}”`, 850); if (lines.length * size * 1.35 < 540) break; size -= 2; } while (size > 28);
  ctx.fillStyle = '#293f34';
  const lineHeight = size * 1.35;
  const quoteTop = 555 + Math.max(0, (470 - lines.length * lineHeight) / 2);
  lines.forEach((line, index) => ctx.fillText(line, 540, quoteTop + index * lineHeight));
  ctx.font = '24px "DM Sans"'; ctx.fillStyle = '#626b5c';
  if (card.place) { const placeLines = wrapCanvasText(ctx, card.place, 860); ctx.fillText(placeLines[0], 540, 1087); }
  ctx.strokeStyle = '#ccd1bc'; ctx.beginPath(); ctx.moveTo(82, 1127); ctx.lineTo(998, 1127); ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = card.mode === 'sample' ? '#825126' : '#293f34'; ctx.font = 'bold 20px "DM Sans"'; ctx.fillText(sourceLabel(card.mode), 82, 1173);
  ctx.fillStyle = '#626b5c'; ctx.font = '23px "DM Sans"'; ctx.fillText(`${card.duration} seconds of listening · My own words`, 82, 1222);
  ctx.font = '20px "DM Sans"'; ctx.fillText('blucca.github.io/soundwalk', 82, 1286);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) { notify('Image creation failed. Your words are available on the card.'); return; }
  const link = document.createElement('a'); const url = URL.createObjectURL(blob);
  link.href = url; link.download = `soundwalk-${card.createdAt.slice(0, 10)}-${card.id.slice(0, 6)}.png`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
  notify('Your sound card image is ready to save.');
}

async function shareCard() {
  const card = state.currentCard;
  if (!card) return;
  const text = `“${card.observation}”\n${GROUPS[card.group].name} · ${card.duration} seconds of listening${card.mode === 'sample' ? ' · Licensed sea-wave sample rehearsal' : ''}\nhttps://blucca.github.io/soundwalk/`;
  try {
    if (navigator.share) await navigator.share({ title: 'My SoundWalk', text });
    else { await navigator.clipboard.writeText(text); notify('Your soundwalk words are copied.'); }
  } catch (error) {
    if (error.name !== 'AbortError') notify('Select the words on your card to copy and share them.');
  }
}

function goHome() {
  flowVersion++;
  activeCapture?.finish(new Error('Recording stopped.'));
  stopTimer();
  setView('home');
}

$('start-button').addEventListener('click', () => prepare('microphone'));
$('sample-button').addEventListener('click', () => prepare('sample'));
$('home-button').addEventListener('click', goHome);
$('notes-button').addEventListener('click', () => { if (!activeCapture) { flowVersion++; renderNotes(); } });
$('notes-start').addEventListener('click', () => prepare('microphone'));
$('record-button').addEventListener('click', record);
$('cancel-record').addEventListener('click', () => activeCapture?.finish(new Error('Recording stopped. Ready for another try.')));
$('record-again').addEventListener('click', () => modelReady ? showRecord() : prepare('microphone'));
$('change-sound').addEventListener('click', renderChoices);
$('minute-button').addEventListener('click', startMinute);
$('pause-button').addEventListener('click', () => timer?.paused ? resumeMinute() : pauseMinute());
$('finish-button').addEventListener('click', () => finishMinute());
$('note-form').addEventListener('submit', saveCard);
$('observation').addEventListener('input', () => { $('character-count').textContent = `${$('observation').value.length} / 280`; });
$('download-card').addEventListener('click', downloadCard);
$('share-card').addEventListener('click', shareCard);
$('another-walk').addEventListener('click', () => prepare('microphone'));
$('delete-card').addEventListener('click', () => { cards = cards.filter(card => card.id !== state.currentCard?.id); persistCards(); renderNotes(); });
$('retry-button').addEventListener('click', () => retry());
$('manual-button').addEventListener('click', () => { flowVersion++; state.mode = 'manual'; state.analysis = null; state.capturedAt = null; renderChoices(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    activeCapture?.finish(new Error('Recording paused while this tab was away. Keep the tab open to record five seconds.'));
    pauseMinute('hidden');
  }
});
window.addEventListener('pagehide', () => { activeCapture?.finish(new Error('Recording stopped.')); stopTimer(); });
$('note-count').textContent = String(cards.length);
