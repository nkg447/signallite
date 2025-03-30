const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
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
      template: "./example.html",
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