# Chinese streaming follow candidate model

Runtime: existing sherpa_onnx 1.13.3 Harmony HAR, CPU / two threads.
Model: sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01.

Author ONNX repository: https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01/tree/a5f60fe00dcfbaf68fcc1c6b5cf53061e144d6da
Original checkpoint / Apache-2.0 model card: https://huggingface.co/csukuangfj/icefall-streaming-zipformer-small-ctc-zh-2025-04-01
Official model usage: https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-ctc/zipformer-ctc-models.html

- model.int8.onnx: 26342340 bytes; SHA256 68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a.
- tokens.txt: 13366 bytes; SHA256 6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd.

Weights were transported through hf-mirror.com after direct host and authorized server retrieval failed; the model digest matches the author's published SHA256. The token digest pins the retrieved fixed-revision bytes; it is not claimed as a separately published author SHA256. The original checkpoint card lists Apache-2.0. LICENSE retains that license text. No checkpoint pickle, remote code, or new SDK is executed.

The ONNX binary is ignored by Git like the project's existing models. Fetch it from the author URL with resolve/a5f60fe00dcfbaf68fcc1c6b5cf53061e144d6da/model.int8.onnx and verify the above digest before building. Do not substitute another model or vocab while keeping these constants.

Desktop recognition and interface export are not Harmony hardware acceptance. Accuracy, display mapping, long-session stability and power remain separate gates.
