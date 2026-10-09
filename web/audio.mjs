/** SoundWalk's audio preparation and broad listening invitations. MIT license. */

export const GROUPS = Object.freeze({
  birds: Object.freeze({
    name: 'Birds & calls',
    eyebrow: 'Follow a small voice',
    prompt: 'For one minute, follow one call. Listen for its next return, the pause between calls, and a second sound farther away.',
    invitation: 'Find the space between calls.'
  }),
  water: Object.freeze({
    name: 'Water & rain',
    eyebrow: 'Find a changing rhythm',
    prompt: 'For one minute, follow a watery rhythm as it rises and falls. Pick out one small splash or drop within the larger wash of sound.',
    invitation: 'Find one small sound inside the flow.'
  }),
  wind: Object.freeze({
    name: 'Wind & leaves',
    eyebrow: 'Hear the texture change',
    prompt: 'For one minute, listen as a rustle builds, softens, and returns. Notice one nearby texture, then a softer sound in the distance.',
    invitation: 'Listen for the next change in texture.'
  }),
  city: Object.freeze({
    name: 'Street rhythms',
    eyebrow: 'Listen near, then far',
    prompt: 'For one minute, stay in one place and follow a passing sound as it approaches and fades. Listen for what becomes audible in the gap afterward.',
    invitation: 'Find a small detail between passing sounds.'
  }),
  life: Object.freeze({
    name: 'Life nearby',
    eyebrow: 'Notice a familiar rhythm',
    prompt: 'For one minute, follow a rhythm nearby: footsteps, a voice, music, or an animal call. Listen to its pattern, then notice the space after it.',
    invitation: 'Give an everyday sound your full attention.'
  }),
  other: Object.freeze({
    name: 'An open ear',
    eyebrow: 'Let your ears choose',
    prompt: 'For one minute, find your nearest sound and your farthest sound. Move your attention between them, then notice one detail you had passed over.',
    invitation: 'Find a detail of your own.'
  })
});

// These are listening groups built from YAMNet's AudioSet labels. A group uses
// its strongest member score, so related parent/child labels count once.
const MEMBERS = {
  birds: [
    'Bird', 'Bird vocalization, bird call, bird song', 'Chirp, tweet', 'Squawk',
    'Pigeon, dove', 'Coo', 'Crow', 'Caw', 'Owl', 'Hoot',
    'Bird flight, flapping wings', 'Fowl', 'Chicken, rooster', 'Cluck',
    'Crowing, cock-a-doodle-doo', 'Turkey', 'Gobble', 'Duck', 'Quack', 'Goose', 'Honk'
  ],
  water: [
    'Water', 'Rain', 'Raindrop', 'Rain on surface', 'Stream', 'Waterfall',
    'Ocean', 'Waves, surf', 'Gurgling', 'Liquid', 'Splash, splatter', 'Slosh',
    'Drip', 'Pour', 'Trickle, dribble', 'Gush', 'Water tap, faucet'
  ],
  wind: ['Wind', 'Rustling leaves', 'Wind noise (microphone)', 'Rustle'],
  city: [
    'Vehicle', 'Motor vehicle (road)', 'Car', 'Vehicle horn, car horn, honking',
    'Car passing by', 'Truck', 'Air brake', 'Air horn, truck horn', 'Reversing beeps',
    'Bus', 'Emergency vehicle', 'Police car (siren)', 'Ambulance (siren)',
    'Fire engine, fire truck (siren)', 'Motorcycle', 'Traffic noise, roadway noise',
    'Rail transport', 'Train', 'Train whistle', 'Train horn', 'Railroad car, train wagon',
    'Train wheels squealing', 'Subway, metro, underground', 'Aircraft', 'Aircraft engine',
    'Jet engine', 'Propeller, airscrew', 'Helicopter', 'Fixed-wing aircraft, airplane',
    'Bicycle', 'Bicycle bell', 'Skateboard', 'Engine', 'Light engine (high frequency)',
    'Lawn mower', 'Chainsaw', 'Medium engine (mid frequency)', 'Heavy engine (low frequency)',
    'Engine starting', 'Idling', 'Accelerating, revving, vroom', 'Church bell',
    'Siren', 'Jackhammer', 'Power tool', 'Mechanical fan', 'Air conditioning'
  ],
  life: [
    'Speech', 'Child speech, kid speaking', 'Conversation', 'Babbling', 'Laughter',
    'Baby laughter', 'Giggle', 'Chuckle, chortle', 'Singing', 'Choir', 'Humming',
    'Whistling', 'Run', 'Shuffle', 'Walk, footsteps', 'Clapping', 'Cheering',
    'Applause', 'Chatter', 'Crowd', 'Hubbub, speech noise, speech babble',
    'Children playing', 'Animal', 'Domestic animals, pets', 'Dog', 'Bark',
    'Yip', 'Howl', 'Bow-wow', 'Growling', 'Whimper (dog)', 'Cat', 'Purr',
    'Meow', 'Livestock, farm animals, working animals', 'Horse', 'Clip-clop',
    'Neigh, whinny', 'Cattle, bovinae', 'Moo', 'Cowbell', 'Pig', 'Oink', 'Goat',
    'Bleat', 'Sheep', 'Wild animals', 'Insect', 'Cricket', 'Mosquito',
    'Fly, housefly', 'Bee, wasp, etc.', 'Frog', 'Croak', 'Music', 'Musical instrument'
  ]
};
const LABEL_GROUP = new Map(Object.entries(MEMBERS)
  .flatMap(([id, labels]) => labels.map(label => [label, id])));

/**
 * Average audio channels and resample to mono PCM, preserving duration.
 * Downsampling uses a windowed-sinc low-pass filter to attenuate frequencies
 * above the destination Nyquist frequency. PCM samples are clamped to [-1, 1].
 * Inputs are read-only; the returned Float32Array owns its buffer.
 */
export function resampleMono(channels, sourceRate, targetRate = 16000) {
  if (!Array.isArray(channels) || channels.length === 0 ||
      channels.some(channel => !(channel instanceof Float32Array))) {
    throw new TypeError('Audio channels must be an array of Float32Array values.');
  }
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 ||
      !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new RangeError('Audio sample rates must be positive finite numbers.');
  }
  const length = channels[0].length;
  if (channels.some(channel => channel.length !== length)) {
    throw new RangeError('Audio channels must have the same sample count.');
  }
  if (length === 0) return new Float32Array();

  const mono = new Float32Array(length);
  const channelWeight = 1 / channels.length;
  for (const channel of channels) {
    for (let i = 0; i < length; i++) {
      const sample = Number.isFinite(channel[i]) ? channel[i] : 0;
      mono[i] += Math.max(-1, Math.min(1, sample)) * channelWeight;
    }
  }
  if (sourceRate === targetRate) return mono;

  const ratio = sourceRate / targetRate;
  const result = new Float32Array(Math.max(1, Math.round(length / ratio)));
  const cutoff = Math.min(1, 1 / ratio) * 0.94;
  const radius = Math.ceil(12 / cutoff);
  const taps = radius * 2 + 1;
  const phases = 256;
  const kernels = new Float64Array((phases + 1) * taps);

  // Polyphase coefficients keep sine/cosine evaluation out of the PCM loop.
  for (let phase = 0; phase <= phases; phase++) {
    const fraction = phase / phases;
    for (let tap = 0; tap < taps; tap++) {
      const distance = tap - radius - fraction;
      const x = Math.PI * cutoff * distance;
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x;
      const window = Math.abs(distance) > radius ? 0 :
        0.42 + 0.5 * Math.cos(Math.PI * distance / radius) +
        0.08 * Math.cos(2 * Math.PI * distance / radius);
      kernels[phase * taps + tap] = cutoff * sinc * window;
    }
  }

  for (let i = 0; i < result.length; i++) {
    const position = i * ratio;
    const center = Math.floor(position);
    const phase = Math.round((position - center) * phases);
    const offset = phase * taps;
    let value = 0;
    let totalWeight = 0;
    for (let tap = 0; tap < taps; tap++) {
      const index = center + tap - radius;
      if (index < 0 || index >= length) continue;
      const weight = kernels[offset + tap];
      value += mono[index] * weight;
      totalWeight += weight;
    }
    const sample = totalWeight ? value / totalWeight : 0;
    result[i] = Math.max(-1, Math.min(1, sample));
  }
  return result;
}

/**
 * Map mean-frame YAMNet matching scores to up to three broad invitations.
 * top: up to five original labels and their matching scores.
 * suggestions: {id, name, score, evidence: [{label, score}]}[].
 * The open-ear fallback has score 0 and empty evidence; it is a user invitation.
 */
export function summarizeScores(scores, labels) {
  if (!scores || !Array.isArray(labels) || scores.length !== labels.length) {
    throw new TypeError('Each model score needs its corresponding class label.');
  }
  const ranked = labels.map((label, index) => {
    const value = Number(scores[index]);
    return { label, score: Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0 };
  }).filter(entry => typeof entry.label === 'string' && entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 5);
  const fallback = { id: 'other', name: GROUPS.other.name, score: 0, evidence: [] };
  const silence = ranked.find(entry => entry.label === 'Silence')?.score ?? 0;
  const threshold = Math.max(0.15, (top[0]?.score ?? 0) * 0.35);

  const byGroup = new Map();
  for (const entry of ranked) {
    const id = LABEL_GROUP.get(entry.label);
    if (!id) continue;
    if (!byGroup.has(id)) byGroup.set(id, []);
    if (byGroup.get(id).length < 3) byGroup.get(id).push(entry);
  }
  const candidates = Array.from(byGroup, ([id, evidence]) => ({
    id, name: GROUPS[id].name, score: evidence[0].score, evidence
  })).filter(group => group.score >= threshold).sort((a, b) => b.score - a.score);

  if (candidates.length === 0 || (silence >= 0.4 && silence >= candidates[0].score)) {
    return { top, suggestions: [fallback] };
  }
  return { top, suggestions: candidates.slice(0, 3) };
}
