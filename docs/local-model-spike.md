# On-device translation on an iPhone 13, inside Cordova

**Not feasible as the translator for this app.**

The phone can run a small English-to-Japanese Marian model in WebAssembly, with real compromises. It cannot host a model that accepts any written language, returns traveller-quality Japanese plus Hepburn, and answers a short sentence in under two seconds, while living inside a Cordova WKWebView. That is the product. The Grok API stays the right engine. An offline mode later is a narrow fallback, not a port of the online translator.

This is a research note. Nothing here is implemented. I did not run these models on an iPhone 13. File sizes below are the published weights. Memory ceilings are from WebKit and from people measuring Safari and WKWebView. Latency is discussed as a bound, not as a benchmark.

The app as shipped accepts any written language and lets Grok name it. The original question was narrower: English or French into Japanese. Both are answered below. The narrower question has one candidate that physically fits. The product as it is now does not.

Checked 31 October 2026. The phone in question is an iPhone 13: A15, 4 GB of unified memory.

## What the WebView actually gives you

Cordova on iOS is a WKWebView. JavaScript does not get the Neural Engine, Core ML, or the higher jetsam limit a native process can ask for. The `increased-memory-limit` entitlement does not raise the web content process. A native Metal build would be a different app.

**WebGPU.** Safari 26 ships WebGPU on iPhone, on by default, with no documented chip cutoff. WebKit’s own note for Safari 26 lists Transformers.js and ONNX Runtime among things that run there. Transformers.js turns its WebGPU path on for iOS 26 and later (Hugging Face PR 1700, merged 8 June 2026). A Cordova app uses the system WebKit, so this follows the iOS version on the phone, not the Xcode version you compiled with. On iOS 18 and earlier, WebGPU is present and off. A Cordova app cannot flip Safari’s feature flag. An iPhone 13 can run these systems: a GPU-memory study in 2026 measured `com.apple.WebKit.GPU` on an iPhone 13 running iOS 27.0.1.

**The GPU process is about 300 MB.** A WebKit change describing media memory says the GPU process jetsam limit is 300 MB. The same ceiling showed up in measurements: on an iPhone, including that iPhone 13, iOS killed `com.apple.WebKit.GPU` at about 300–305 MB. WebGPU weights live in that process. A model file larger than roughly 150 MB, once runtime buffers are counted, is a bad bet for GPU residency. Crossing the line loses the device or gets the process killed. It does not page out politely.

**WebGPU on iOS also stalls if you submit too much.** WebKit bug 311598, from a llama.cpp WebGPU port tested on iOS 26.3 and 26.4, is that more than one command buffer in flight can hang the queue. The WebKit response was that iOS wants one command buffer at a time, each with milliseconds of work. LLM runtimes that fire hundreds of tiny dispatches per token fight that. A small encoder-decoder does fewer dispatches and is less exposed. A 0.5B transformer decode loop is the worst shape.

**Web content memory is a moving cap, and 4 GB is the whole phone.** There is no documented per-tab number. Reports collected against iOS 26 put a 6 GB phone somewhere around 1.5 GB of web content after the device has been awake, and sometimes higher right after a reboot. A 4 GB phone has less room, and the cap moves with whatever else iOS is holding. The failure mode is a reload, not a catchable exception: “This webpage was reloaded because it was using significant memory.” Plan as if a few hundred megabytes is comfortable and a gigabyte is a crash.

**WASM is the dependable compute path.** It has been in iOS for years. SIMD is there from iOS 16.4, which an iPhone 13 has. Threads are not a plan. SharedArrayBuffer needs cross-origin isolation (`COOP` / `COEP`). Cordova serves the app from `app://localhost` and does not send those headers. ONNX Runtime Web and llama.cpp WASM would run single-threaded.

**Caching.** IndexedDB and the Cache API work in a normal WKWebView. A first launch can download weights and keep them in the app container, which is more stable than a Safari tab, and a reinstall or an offload still deletes them. iOS can also purge website data under storage pressure. Anything the offline mode needs in order to work on a train should be in the app bundle, not a download that happens the first time you need it.

## Candidate 1 — Marian / OPUS-MT, one language pair

This is the only candidate that fits the memory of the WebView.

The published Transformers.js pack is `Xenova/opus-mt-en-jap`. On the ONNX tree, the quantized files a session actually loads are about:

| File | Size |
| --- | --- |
| `encoder_model_quantized.onnx` | 43.3 MB |
| `decoder_model_merged_quantized.onnx` | 50.6 MB |

About 94 MB of weights for English → Japanese, plus a tokenizer of a few megabytes. The same family of OPUS-MT models is a small Marian transformer (the public Helsinki-NLP cards for this generation are around 75 million parameters; the number that matters here is the file size above). A French → Japanese pack is the same kind of object if you convert `Helsinki-NLP/opus-mt-fr-jap` the same way. I could not confirm a ready-made Xenova ONNX repo for French from this machine. Two pairs is on the order of 200 MB in the IPA.

Runtime memory is the weights in the WASM heap plus activation tensors for a short sentence. That should stay in the low hundreds of megabytes. It fits the web content process. It does not need WebGPU, and it should not be put on the GPU: 94 MB of weights plus ORT’s GPU buffers is already bumping into a 300 MB jetsam limit, for a model that does not need it.

Latency, as a bound rather than a measurement: this is a small encoder and a short decode. On desktop WASM, models in this class finish a sentence well under a second once the session is warm. A single WASM thread on an A15 is slower. A warm short sentence can plausibly land around one to three seconds. The first call also pays to compile the WASM and to load the graph. That first call will not make a two-second promise. I would measure it on the phone before believing the warm number.

Quality is the real gap. OPUS-MT is trained on parallel bitext. Short, literal travel sentences are its best case. Politeness, names, and anything conversational are weaker than Grok, and French → Japanese bitext is thinner than English → Japanese. The output is kanji and kana, not Hepburn. `wanakana` only romanizes kana. A kanji reading needs a dictionary such as kuromoji (tens of megabytes more) or a second model. The app’s Hepburn module already refuses to invent kanji readings, for this reason.

Coverage is the other gap. One Marian model is one direction. English and French would be two downloads and two sessions, and the product is no longer “English or French.” Korean, Arabic, or a mix would miss. A tiny language-id model could choose between the two pairs and refuse everything else. That is a fallback with a label on it, not this app’s translator.

## Candidate 2 — NLLB-200 distilled 600M, or M2M

This is the candidate that matches “any written language.” It does not fit.

`Xenova/nllb-200-distilled-600M` quantized ONNX, the files a merged session needs:

| File | Size |
| --- | --- |
| `encoder_model_quantized.onnx` | 419 MB |
| `decoder_model_quantized.onnx` | 471 MB |
| `decoder_model_merged_quantized.onnx` | 476 MB |

Encoder plus one decoder is about 890 MB before the tokenizer, the WASM runtime, and the activations. The fp32 decoder on the same tree is 1.86 GB. The q4f16 merged decoder alone is 642 MB, and its encoder is another 612 MB. A 4-bit GGUF of the same model is listed around 472 MB, which is a smaller file and still has to be unpacked into a runtime that this WebView is not set up to run well.

890 MB of ONNX is already at the reported web-content ceiling of phones with more RAM than the iPhone 13, before a single token is decoded. Loading it is the likely crash, not the steady state. WebGPU cannot absorb it. The GPU process dies near 300 MB.

M2M-100 at 418 million parameters sits in the same bucket. I did not pull a quantized ONNX listing for it. The full-precision checkpoint is about 1.6 GB, so a useful quantization is still several hundred megabytes and still one language-agnostic model that has to beat NLLB to be worth the risk. It is not a better fit than NLLB, and NLLB does not fit.

Quality of the 600M NLLB distillation is the best of the local options for many-to-Japanese, and it is still a distilled 600M model from 2022, not Grok. It also emits Japanese script. Hepburn is a second step, same as Marian. Latency on one WASM thread for a 600M decoder is a multi-second decode for a short sentence, and that assumes the page survived the load.

## Candidate 3 — a 0.5B to 1B LLM (Qwen, Gemma) on WebGPU or WASM

This is the option that can be prompted for romaji directly, and for any input language. It is the wrong size and the wrong runtime.

`bartowski/Qwen2.5-0.5B-Instruct-GGUF` lists `Qwen2.5-0.5B-Instruct-Q4_K_M.gguf` at 0.40 GB. Q8 is 0.53 GB. F16 is 0.99 GB. A 0.40 GB weight file plus a KV cache and the WASM runtime wants on the order of 0.6–0.9 GB of web content if you are lucky and the allocator is not. That can survive on a quiet phone and will not survive a phone that is already tight. It cannot be the GPU-resident working set. 400 MB is over the 300 MB GPU-process line before activations.

Gemma 3 1B is a 1.0 billion parameter model on the Google model card (`ggml-org/gemma-3-1b-it-GGUF`). At 4-bit that is on the order of 0.6–0.9 GB of weights. Catalog listings put the Q4_K_M GGUF near 0.8 GB. That is a worse fit than Qwen 0.5B on a 4 GB phone, not a better one. Gemma 2B-class models are out.

WebLLM and MLC expect WebGPU. On this phone that means iOS 26 or newer, a 300 MB GPU budget, and the command-buffer behaviour in bug 311598. A decode step that submits hundreds of shaders will either be rewritten to one fat command buffer or it will stall. WASM via something like wllama avoids the GPU cap and lands in the web-content cap instead, on one thread.

I will not quote a tokens-per-second figure I did not measure. The bound is enough. A short translation is tens of output tokens, generated one step at a time. Desktop GPU stacks make a 0.5B model feel instant. A single WASM thread on a phone does not. It is not in the “under two seconds for a 20-word sentence” class, and a cold load of a 400 MB file is not either. Quality at 0.5B is a further step down from NLLB for translation, with more invented politeness and less stable Japanese. Asking it for Hepburn in the same pass makes the output format luck.

## Side by side

| | OPUS-MT, one pair | NLLB-200 600M, quantized | Qwen2.5 0.5B Q4 | Gemma 3 1B Q4 |
| --- | --- | --- | --- | --- |
| Weights | ~94 MB | ~890 MB ONNX | 0.40 GB file | ~0.6–0.9 GB |
| Fits web content on a 4 GB iPhone | Yes | No. Load is the crash. | Tight. Often no. | No. |
| Fits the ~300 MB GPU process | No, and it does not need to | No | No | No |
| Any input language | No. One pair, one direction. | Yes | Attempted, uneven | Attempted, uneven |
| Hepburn | Extra step. Kanji needs a dictionary. | Extra step | Prompted, unstable | Prompted, unstable |
| Warm latency vs a 2 second budget | Plausible for a short sentence, unmeasured | Unlikely, if it loads | Unlikely | Unlikely |
| First launch | Bundle ~100 MB, or a download you should not depend on | A gigabyte-class download | Hundreds of MB | Larger than Qwen |

## What a later offline mode would actually take

1. Keep Grok as the online translator. Do not block the ship on a local model.
2. Do not plan on WebGPU weight residency until a measurement on this iPhone 13 shows the GPU process staying under the jetsam line with the model loaded. Today’s evidence says it will not, for anything bigger than a toy.
3. If the offline path must accept any language, it needs a multilingual model in the NLLB class. That model does not fit this WebView. The honest move is to leave Cordova and run a native runtime (Core ML, MLX, or llama.cpp against Metal) that can use more memory and the Neural Engine. That is a different product, with Swift, and it still has to be measured on 4 GB. It is out of scope for this codebase on purpose.
4. If the offline path can be narrower than the product, the build is: ship the quantized `Xenova/opus-mt-en-jap` pair inside the app, add a French pair only if you convert one, run ONNX Runtime Web’s single-thread WASM in a worker, and keep the existing Hepburn module for kana. A small language-id model can choose the pair. Anything it does not know should fail visibly, not guess. Show a label that the phrase was translated offline. Measure warm and cold latency on the iPhone 13 before promising two seconds. Bundle the weights. A first-launch download is how you get a blank result on a train.
5. Kuromoji, or any other kanji reader, is a separate cost and a separate quality problem. If the offline model cannot emit kana, the romaji will be wrong often enough to matter. Prefer a model target that emits kana, or accept that offline romaji is best-effort.

The evidence says: feasible for a small bilingual Marian fallback, not feasible for the translator this app is.
