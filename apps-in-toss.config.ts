import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'ssok-picky-pad',
  brand: {
    primaryColor: '#E85D9E',
  },
  permissions: [],
  navigationBar: {
    withBackButton: true,
    withHomeButton: false,
    withTitle: true,
    transparentBackground: false,
    theme: 'light',
  },
  webView: {
    bounces: false,
    pullToRefreshEnabled: false,
    overScrollMode: 'never',
  },
  webBundleDir: 'dist',
});
