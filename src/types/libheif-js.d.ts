// libheif-js ships emscripten-generated typings for the raw C bindings, but
// nothing for the small JS wrapper classes - which is the only part used here.
declare module "libheif-js/wasm-bundle" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      imageData: ImageData,
      callback: (result: ImageData | null) => void
    ): void;
  }
  interface HeifDecoderInstance {
    decode(buffer: Uint8Array): HeifImage[];
  }
  interface LibHeif {
    HeifDecoder: new () => HeifDecoderInstance;
  }
  const libheif: LibHeif;
  export default libheif;
}
