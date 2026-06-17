import { defineConfig } from 'vitepress'
import { tabsMarkdownPlugin } from 'vitepress-plugin-tabs'
import githubAlertsPlugin from './plugins/githubAlertsPlugin'
import youtubeEmbedPlugin from './plugins/youtubeEmbedPlugin'
import lineNumberPlugin from './plugins/lineNumbers'
import navigation from '../navigation.json'
import siteSettings from '../site-settings.json'
import { navigationToSidebar } from './navigation'

function cmsCodeBlockPlugin(md: any) {
  const defaultFence = md.renderer.rules.fence || ((tokens: any[], idx: number, options: any, env: any, self: any) => self.renderToken(tokens, idx, options))
  md.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx]
    const info = token.info || ''
    const captionMatch = info.match(/caption="((?:\\"|[^"])*)"/)
    const caption = captionMatch ? captionMatch[1].replace(/\\"/g, '"') : ''
    const nowrap = /\bnowrap\b/.test(info)
    if (!caption && !nowrap) return defaultFence(tokens, idx, options, env, self)
    token.info = info.replace(/caption="(?:\\"|[^"]*)"/, '').replace(/\bnowrap\b/, '').trim()
    const rendered = defaultFence(tokens, idx, options, env, self)
    const classes = ['cms-code-block', nowrap ? 'cms-code-nowrap' : 'cms-code-wrap'].join(' ')
    const captionHtml = caption ? `<figcaption>${md.utils.escapeHtml(caption)}</figcaption>` : ''
    return `<figure class="${classes}">${captionHtml}${rendered}</figure>`
  }
}

export default defineConfig({
  title: siteSettings.title,
  srcDir: 'src',
  description: siteSettings.description,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#24292f' }],
    ['link', { rel: 'icon', href: siteSettings.logo }],
    ['link', { rel: 'manifest', href: '/images/site.webmanifest' }],
  ],
  themeConfig: {
    logo: {
      dark: siteSettings.logo,
      light: siteSettings.logo,
    },
    search: {
      provider: 'local',
    },
    nav: siteSettings.navLinks.map((item) => ({ text: item.label, link: item.url })),
    outline: 'deep',
    sidebar: navigationToSidebar(navigation),
    socialLinks: siteSettings.githubUrl ? [{ icon: 'github' as const, link: siteSettings.githubUrl }] : [],
    editLink: siteSettings.githubUrl
      ? {
          text: 'Edit this page',
          pattern: `${siteSettings.githubUrl.replace(/\/$/, '')}/edit/main/docs/src/:path`,
        }
      : undefined,
  },
  markdown: {
    config(md) {
      md.use(tabsMarkdownPlugin)
      md.use(githubAlertsPlugin)
      md.use(youtubeEmbedPlugin)
      md.use(lineNumberPlugin)
      md.use(cmsCodeBlockPlugin)
    },
  },
})
