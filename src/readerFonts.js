import sourceHanSerifRegularUrl from './ui-b/assets/dark-shelf/SourceHanSerifCN-Medium.otf'
import sourceHanSerifBoldUrl from './ui-b/assets/dark-shelf/SourceHanSerifCN-Bold.otf'
import sourceHanSansRegularUrl from './assets/reader-fonts/SourceHanSansCN-Regular.otf'
import sourceHanSansBoldUrl from './assets/reader-fonts/SourceHanSansCN-Bold.otf'
import lxgwWenKaiUrl from './assets/reader-fonts/LXGWWenKaiGBScreen.ttf'

const resolveAssetUrl = (value) => {
  try { return new URL(value, globalThis.location?.href).href } catch { return value }
}

const EPUB_FONT_URLS = {
  sourceHanSerifRegular: resolveAssetUrl(sourceHanSerifRegularUrl),
  sourceHanSerifBold: resolveAssetUrl(sourceHanSerifBoldUrl),
  sourceHanSansRegular: resolveAssetUrl(sourceHanSansRegularUrl),
  sourceHanSansBold: resolveAssetUrl(sourceHanSansBoldUrl),
  lxgwWenKai: resolveAssetUrl(lxgwWenKaiUrl),
}

export const READER_FONT_OPTIONS = [
  { label: '思源宋体', value: 'serif' },
  { label: '思源黑体', value: 'sans' },
  { label: '霞鹜文楷', value: 'kai' },
]

const READER_FONT_STACKS = {
  serif: '"Moyu Source Han Serif", "Source Han Serif SC", "Songti SC", SimSun, serif',
  sans: '"Moyu Source Han Sans", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
  kai: '"Moyu LXGW WenKai", "LXGW WenKai", KaiTi, STKaiti, serif',
}

export function getReaderFontStack(value) {
  return READER_FONT_STACKS[value] || READER_FONT_STACKS.serif
}

export function installReaderFonts(document) {
  if (!document?.head || document.getElementById('moyu-reader-fonts')) return
  const style = document.createElement('style')
  style.id = 'moyu-reader-fonts'
  style.textContent = `
    @font-face { font-family: "Moyu Source Han Serif"; src: url("${EPUB_FONT_URLS.sourceHanSerifRegular}") format("opentype"); font-weight: 400; font-style: normal; }
    @font-face { font-family: "Moyu Source Han Serif"; src: url("${EPUB_FONT_URLS.sourceHanSerifBold}") format("opentype"); font-weight: 700; font-style: normal; }
    @font-face { font-family: "Moyu Source Han Sans"; src: url("${EPUB_FONT_URLS.sourceHanSansRegular}") format("opentype"); font-weight: 400; font-style: normal; }
    @font-face { font-family: "Moyu Source Han Sans"; src: url("${EPUB_FONT_URLS.sourceHanSansBold}") format("opentype"); font-weight: 700; font-style: normal; }
    @font-face { font-family: "Moyu LXGW WenKai"; src: url("${EPUB_FONT_URLS.lxgwWenKai}") format("truetype"); font-weight: 400; font-style: normal; }
    @font-face { font-family: "Moyu LXGW WenKai"; src: url("${EPUB_FONT_URLS.lxgwWenKai}") format("truetype"); font-weight: 700; font-style: normal; }
  `
  document.head.appendChild(style)
}
