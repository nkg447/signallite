import path from "path";
import { fileURLToPath } from "url";
import HtmlWebpackPlugin from "html-webpack-plugin";
import TerserPlugin from "terser-webpack-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  mode: "development", // Will still be development for dev builds
  entry: "./WebRTCClient.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "webrtc-client.js",
    library: {
      name: "WebRTCClient",
      type: "umd",
      export: "default",
    },
    globalObject: "this",
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"],
          },
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./chat.html",
      filename: "index.html",
    }),
  ],
  devServer: {
    static: path.join(__dirname, "dist"),
    compress: true,
    port: 3000,
    open: true,
  },
  resolve: {
    extensions: [".js"],
  },
  devtool: "source-map",
  optimization: {
    minimize: true, // Enable minification even in development mode
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: false, // Set to true to remove console logs
          },
          format: {
            comments: false, // Remove comments
          },
        },
        extractComments: false, // Don't extract comments to a separate file
      }),
    ],
  },
};