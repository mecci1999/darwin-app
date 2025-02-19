const typescript = require('@rollup/plugin-typescript');
const commonjs = require('@rollup/plugin-commonjs');
const dts = require('rollup-plugin-dts');
const tscAlias = require('rollup-plugin-tsc-alias');
const json = require('@rollup/plugin-json');
const { terser } = require('rollup-plugin-terser');

module.exports = [
  {
    input: ['./src/gateway/index.ts', './src/custom/index.ts'], // 多个入口文件
    output: {
      dir: 'dist',
      format: 'cjs',
      // sourcemap: true,
      plugins: [terser()],
    },
    plugins: [
      commonjs(), // 处理 CommonJS 模块
      tscAlias(),
      typescript({ tsconfig: './tsconfig.build.json' }), // 使用 TypeScript 插件
      json(),
    ],
  },
  // {
  //   input: './src/index.ts',
  //   output: [{ file: 'dist/index.d.ts', format: 'esm' }],
  //   plugins: [
  //     dts.default({
  //       tsconfig: './tsconfig.build.json',
  //     }),
  //   ],
  // },
];
