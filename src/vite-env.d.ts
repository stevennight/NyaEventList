/// <reference types="vite/client" />

/** 构建时注入的版本信息，见 vite.config.ts */
declare const __APP_INFO__: {
  name: string;
  version: string;
  commit: string;
  buildDate: string;
  updateRepository: string;
};
