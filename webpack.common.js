const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");

module.exports = {
  entry: {
    index: "./fhodot/app/ui/src/index.js",
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(
        __dirname, "./fhodot/app/ui/src/index.html",
      ),
      chunks: ["index"],
      inject: "head",
      scriptLoading: "defer",
    }),
  ],
  output: {
    filename: "[name].bundle.js",
    path: path.resolve(__dirname, "./fhodot/app/ui/dist"),
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.png$/,
        use: ["file-loader"],
      },
    ],
  },
};
