/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // @huggingface/transformers はNode向けビルドでのみ sharp / onnxruntime-node を使う。
    // ブラウザ向けバンドルでこれらを解決しようとして失敗するのを防ぐ(公式に案内されている回避策)。
    config.resolve.alias = {
      ...config.resolve.alias,
      "sharp$": false,
      "onnxruntime-node$": false,
    };
    return config;
  },
};

export default nextConfig;
