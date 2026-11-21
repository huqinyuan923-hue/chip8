/** esbuild 以 text loader 内嵌 .ch8.asm 源码（见 scripts/build-web.mjs）；TS 侧的环境声明。 */
declare module '*.ch8.asm' {
  const content: string;
  export default content;
}
