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
        label: 'API Reference',
        route: '/api-reference',
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
          to: '/api-reference',
          label: 'API Reference',
          position: 'left',
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
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'WebSocket', to: '/docs/websocket' },
            { label: 'M-Pesa', to: '/docs/mpesa' },
          ],
        },
        {
          title: 'Kakitu',
          items: [
            { label: 'Explorer', href: 'https://kakitu.org' },
            { label: 'GitHub', href: 'https://github.com/kakitucurrency' },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Kakitu. 1 KSHS = 1 KES.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
