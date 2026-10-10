# SoundWalk licenses and credits

SoundWalk application code is released under the [MIT license](LICENSE).
The bundled model, runtime, and demonstration recording retain their licenses.

## YAMNet model and labels — Apache 2.0

- **Model:** Google's YAMNet, TensorFlow.js format, version 1.
- **Official model:** <https://www.kaggle.com/models/google/yamnet/TfJs/tfjs>.
- **Model source:** <https://github.com/tensorflow/models/tree/master/research/audioset/yamnet>.
- **Bundled files:** [`web/model/model.json`](web/model/model.json), four `group1-shard*of4.bin` files, `class-map.csv`, and `labels.json`.
- **License copy:** [`web/model/LICENSE`](web/model/LICENSE), including the upstream copyright notice.

The graph and weights are the original TensorFlow.js artifact downloaded from
`https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1/` using `?tfjs-format=file`.
Google's official Kaggle metadata identifies this TF.js model instance as
**Apache 2.0** (instance 631, version 1).

`labels.json` converts the official `yamnet_class_map.csv` `display_name` column
to an array in class-index order. The 521 label strings are preserved. SoundWalk
averages frame matching scores and groups selected labels into broad listening
invitations. Its prompts and grouping rules are original application code.

## TensorFlow.js runtime — Apache 2.0

- **Runtime:** TensorFlow.js 4.22.0, copyright 2024 Google LLC.
- **Source:** <https://github.com/tensorflow/tfjs/tree/tfjs-v4.22.0>.
- **Pinned distribution:** <https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js>.
- **Bundled file:** [`web/vendor/tf.min.js`](web/vendor/tf.min.js), copied unchanged with its license header.
- **License copy:** [`web/vendor/LICENSE`](web/vendor/LICENSE).

## Sea-wave demonstration — CC BY 3.0 Unported

> Sea-wave recording by **HerbertBoland**, “**Branding_kort.wav**,”
> [Freesound #28135](https://freesound.org/people/HerbertBoland/sounds/28135/),
> via **ESC-10 clip 1-28135-A-11**, licensed under
> [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).

- **Bundled audio:** [`web/audio/sea-waves.wav`](web/audio/sea-waves.wav).
- **Dataset source:** <https://github.com/karoldvl/ESC-50>, curated by Karol J. Piczak.
- **Exact dataset clip:** <https://raw.githubusercontent.com/karoldvl/ESC-50/master/audio/1-28135-A-11.wav>.
- **Changes:** the existing five-second, 44.1 kHz ESC-10 excerpt is renamed
  `sea-waves.wav` with its bytes preserved. The application resamples the excerpt
  to mono 16 kHz in device memory for model inference.
- **License copy:** [`web/audio/CC-BY-3.0.txt`](web/audio/CC-BY-3.0.txt).
- **Upstream attribution record:** [`web/audio/ESC-50-LICENSE.txt`](web/audio/ESC-50-LICENSE.txt).

The selected clip belongs to the **ESC-10 subset**, which the dataset's license
explicitly releases under CC BY 3.0. The upstream record also describes the
larger ESC-50 collection and its separate collection-level license.

Dataset citation: Karol J. Piczak, *ESC: Dataset for Environmental Sound
Classification*, ACM Multimedia 2015. <https://doi.org/10.1145/2733373.2806390>.

The [narrated browser film](https://blucca.github.io/soundwalk/demo/) loops and
mixes this same sea-wave audio during its listening sequence. The film, watch
page, and transcript retain the recording credit and CC BY 3.0 link. Original
application footage and artwork are by Blucca with Codex; the English voice is
synthesized. The observation shown in the film is a labeled scripted example.

## Asset integrity

[`web/model/provenance.json`](web/model/provenance.json) records source URLs,
file sizes, SHA-256 hashes, licenses, and transformations. All `files[].path`
values are relative to `web/`; `model.weightsManifestPaths` preserves the shard
paths relative to the graph manifest.

## DM Sans typeface — SIL Open Font License 1.1

DM Sans by the DM Sans Project Authors is used for the interface. The Latin
WOFF2 is self-hosted in `web/assets/fonts/`; its [license](web/assets/fonts/OFL.txt)
and [source/hash record](web/assets/fonts/provenance.json) are retained alongside it.
Upstream: <https://github.com/google/fonts/tree/main/ofl/dmsans>.
