// Cross-origin isolation lets the Python worker share an interrupt buffer
// with the main thread (SharedArrayBuffer), so runaway code can be stopped.
// Used by the Vite dev/preview servers and the production server.
export const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
