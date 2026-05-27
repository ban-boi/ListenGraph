/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIXTURE_LAB?: string;
}

import type { ListenGraphicFixtureAPI } from './sidepanel/fixture-sequence-controller';

declare global {
  // eslint-disable-next-line no-var
  var __listenGraphicFixture: ListenGraphicFixtureAPI | undefined;
}

export {};
