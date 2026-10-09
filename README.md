# ITDC 离线 OCR 模型（int8）

字体（文字）检测与识别用的 PP-OCRv4 ONNX 模型，供 ITDC 的「离线 OCR 扩展」按需下载。

- 来源：PaddleOCR PP-OCRv4 mobile 权重（经 RapidOCR 转换的 ONNX 版），
  原始文件取自 https://huggingface.co/SWHL/RapidOCR/tree/main/PP-OCRv4
- 处理：onnxruntime 动态量化（weight_type=QInt8）。Paddle2ONNX 会把部分卷积权重
  放在 Constant 节点里，量化前先把 Constant 折成 initializer（det 342 个 / rec 420 个），
  否则量化器会报 "Expected conv2d_*.w_0 to be an initializer"。
- 体积：ch_PP-OCRv4_det_infer 4.53MB → 1.27MB；ch_PP-OCRv4_rec_infer 10.35MB → 2.76MB
- 许可：Apache-2.0（PaddleOCR / RapidOCR 均为 Apache-2.0），
  本项目仅做格式转换，未改动模型结构与训练权重来源。
- 转换脚本：见主仓库 scripts/doc 或 CHANGELOG「离线 OCR 扩展」一节。
