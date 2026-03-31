export type BuildInfo = {
  version: string;
  buildId: string;
  label: string;
};

const VERSION =
  typeof __LISTEN_GRAPHIC_VERSION__ === 'string'
    ? __LISTEN_GRAPHIC_VERSION__
    : 'dev';

const BUILD_ID =
  typeof __LISTEN_GRAPHIC_BUILD_ID__ === 'string'
    ? __LISTEN_GRAPHIC_BUILD_ID__
    : 'dev';

export const BUILD_INFO: BuildInfo = {
  version: VERSION,
  buildId: BUILD_ID,
  label: `v${VERSION}#${BUILD_ID}`,
};
