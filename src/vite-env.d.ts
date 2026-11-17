/// <reference types="vite/client" />

declare module '*.raw.js?raw' {
  const content: string;
  export default content;
}

declare module '*?raw' {
  const content: string;
  export default content;
}
