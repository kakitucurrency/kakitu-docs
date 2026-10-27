import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Kakitu API',
  tagline: 'Developer documentation for the Kakitu wallet API',
  favicon: 'img/kakitu-logo.png',
  url: 'https://developer.kakitu.org',
  baseUrl: '/',
  organizationName: 'kakitucurrency',
  projectName: 'kakitu-docs',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  plugins: [
    [
      '@scalar/docusaurus',
      {
        // This label IS the navbar entry — the Scalar plugin adds one itself. Do not also
        // add a manual {to: '/api-reference'} item in navbar.items, or the bar shows two.
        label: 'API Reference',
        route: '/api-reference',
        // SELF-HOSTED, PINNED. The plugin's default is
        // https://cdn.jsdelivr.net/npm/@scalar/api-reference with NO version, and it injects
        // that tag into preBodyTags — which is GLOBAL. Every page on this site was loading
        // whatever jsdelivr happened to serve as `latest` at the moment the page opened,
        // executing with full DOM access. On /signup, which generates a merchant's private
        // key in the browser, that is a third party we do not control sharing a document with
        // a secret that controls real money.
        //
        // static/js/scalar-api-reference.js is @scalar/api-reference@1.76.0, the version that
        // URL resolved to on 2026-10-26, vendored verbatim.
        //   sha256 dcb027152bf20bf2f6dcd66e8f9fb073c1a9e274cf0b94b939a7d99ab8947060
        // To update it: fetch the new pinned version, replace the file, record the new hash
        // here, and check /api-reference still renders before pushing.
        cdn: '/js/scalar-api-reference.js',
        configuration: {
          spec: { url: '/openapi.yaml' },
          theme: 'saturn',
          darkMode: true,
        },
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Kakitu API',
      logo: {
        alt: 'Kakitu Logo',
        src: 'img/kakitu-logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/signup',
          label: 'Register',
          position: 'right',
        },
        {
          href: 'https://kakitu.org',
          label: 'Explorer',
          position: 'right',
        },
        {
          href: 'https://github.com/kakitucurrency',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    // NO FOOTER. Docusaurus renders one by default and it was a two-column link list with a
    // copyright line — the same furniture every Docusaurus site carries, which is exactly what
    // makes a site look generated rather than made. Everything it held is reachable from the
    // navbar or the sidebar, so it was duplication wearing a dark background.
    //
    // Omitting the key entirely is what removes it; an empty object still renders the bar.
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
