/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIXTURE_LAB?: string;
  readonly VITE_LAYOUT_ENGINE?: string;
}

import type { ListenGraphicFixtureAPI } from './sidepanel/fixture-sequence-controller';

declare global {
  var __listenGraphicFixture: ListenGraphicFixtureAPI | undefined;
}

export {};
