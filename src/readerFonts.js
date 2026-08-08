import sourceHanSerifRegularUrl from './ui-b/assets/dark-shelf/SourceHanSerifCN-Medium.otf'
import sourceHanSerifBoldUrl from './ui-b/assets/dark-shelf/SourceHanSerifCN-Bold.otf'
import sourceHanSansRegularUrl from './assets/reader-fonts/SourceHanSansCN-Regular.otf'
import sourceHanSansBoldUrl from './assets/reader-fonts/SourceHanSansCN-Bold.otf'
import lxgwWenKaiUrl from './assets/reader-fonts/LXGWWenKaiGBScreen.ttf'
import pingFangRegularUrl from './assets/reader-fonts/families/PingFang-Regular.ttf'
import pingFangBoldUrl from './assets/reader-fonts/families/PingFang-Bold.ttf'
import fengYaRegularUrl from './assets/reader-fonts/families/FZFengYa-Regular.ttf'
import fengYaDemiBoldUrl from './assets/reader-fonts/families/FZFengYa-DemiBold.ttf'
import tsukuMinRegularUrl from './assets/reader-fonts/families/FZTsukuMin-Regular.ttf'
import tsukuMinBoldUrl from './assets/reader-fonts/families/FZTsukuMin-Bold.ttf'
import youSongVariableUrl from './assets/reader-fonts/families/FZYouSong-Variable.ttf'
import lanTingHeiVariableUrl from './assets/reader-fonts/families/FZLanTingHei-Variable.ttf'
import youHeiVariableUrl from './assets/reader-fonts/families/FZYouHei-Variable.ttf'
import tsukuGothicRegularUrl from './assets/reader-fonts/families/FZTsukuGothic-Regular.ttf'
import tsukuGothicBoldUrl from './assets/reader-fonts/families/FZTsukuGothic-Bold.ttf'

const resolveAssetUrl = (value) => {
  try { return new URL(value, globalThis.location?.href).href } catch { return value }
}

const EPUB_FONT_URLS = Object.fromEntries(Object.entries({
  sourceHanSerifRegular: sourceHanSerifRegularUrl,
  sourceHanSerifBold: sourceHanSerifBoldUrl,
  sourceHanSansRegular: sourceHanSansRegularUrl,
  sourceHanSansBold: sourceHanSansBoldUrl,
  lxgwWenKai: lxgwWenKaiUrl,
  pingFangRegular: pingFangRegularUrl,
  pingFangBold: pingFangBoldUrl,
  fengYaRegular: fengYaRegularUrl,
  fengYaDemiBold: fengYaDemiBoldUrl,
  tsukuMinRegular: tsukuMinRegularUrl,
  tsukuMinBold: tsukuMinBoldUrl,
  youSongVariable: youSongVariableUrl,
  lanTingHeiVariable: lanTingHeiVariableUrl,
  youHeiVariable: youHeiVariableUrl,
  tsukuGothicRegular: tsukuGothicRegularUrl,
  tsukuGothicBold: tsukuGothicBoldUrl,
}).map(([key, value]) => [key, resolveAssetUrl(value)]))

const REGULAR_BOLD_FACES = [
  { label: 'Regular', value: 400 },
  { label: 'Bold', value: 700 },
]

const VARIABLE_FACES = [
  { label: 'Light', value: 300 },
  { label: 'Regular', value: 400 },
  { label: 'Medium', value: 500 },
  { label: 'SemiBold', value: 600 },
  { label: 'Bold', value: 700 },
]

export const READER_FONT_OPTIONS = [
  { label: '思源宋体', value: 'serif', faces: REGULAR_BOLD_FACES },
  { label: '思源黑体', value: 'sans', faces: REGULAR_BOLD_FACES },
  { label: '霞鹜文楷', value: 'kai', faces: [{ label: 'Regular', value: 400 }, { label: 'Bold（合成）', value: 700 }] },
  { label: '苹方', value: 'pingfang', faces: REGULAR_BOLD_FACES },
  { label: '方正风雅楷宋（简繁）', value: 'fengya', faces: [{ label: 'Regular', value: 400 }, { label: 'DemiBold', value: 600 }] },
  { label: '方正筑紫明朝', value: 'tsukumin', faces: REGULAR_BOLD_FACES },
  { label: '方正悠宋', value: 'yousong', faces: VARIABLE_FACES },
  { label: '方正兰亭黑', value: 'lantinghei', faces: VARIABLE_FACES },
  { label: '方正悠黑', value: 'youhei', faces: VARIABLE_FACES },
  { label: '方正筑紫黑', value: 'tsukugothic', faces: REGULAR_BOLD_FACES },
]

const READER_FONT_VALUES = new Set(READER_FONT_OPTIONS.map((option) => option.value))

export function normalizeReaderFontFamily(value, fallback = 'serif') {
  if (READER_FONT_VALUES.has(value)) return value
  return READER_FONT_VALUES.has(fallback) ? fallback : 'serif'
}

export function getReaderFontFaceOptions(value) {
  const family = READER_FONT_OPTIONS.find((option) => option.value === value)
  return family?.faces || REGULAR_BOLD_FACES
}

export function getNearestReaderFontWeight(value, weight, fallback = 400) {
  const faces = getReaderFontFaceOptions(value)
  const requested = Number.isFinite(Number(weight)) ? Number(weight) : fallback
  return faces.reduce((nearest, face) => {
    const distance = Math.abs(face.value - requested)
    const nearestDistance = Math.abs(nearest.value - requested)
    return distance < nearestDistance || (distance === nearestDistance && face.value > nearest.value) ? face : nearest
  }, faces[0]).value
}

export function normalizeEpubFontOverride(value, fallback = 'serif') {
  const fallbackFont = normalizeReaderFontFamily(fallback)
  const titleFont = normalizeReaderFontFamily(value?.titleFont, fallbackFont)
  const bodyFont = normalizeReaderFontFamily(value?.bodyFont, fallbackFont)
  return {
    active: value !== null && value !== undefined,
    force: Boolean(value?.force ?? value?.enabled),
    titleFont,
    titleWeight: getNearestReaderFontWeight(titleFont, value?.titleWeight, 700),
    bodyFont,
    bodyWeight: getNearestReaderFontWeight(bodyFont, value?.bodyWeight, 400),
  }
}

const READER_FONT_STACKS = {
  serif: '"Moyu Source Han Serif", "Source Han Serif SC", "Songti SC", SimSun, serif',
  sans: '"Moyu Source Han Sans", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
  kai: '"Moyu LXGW WenKai", "LXGW WenKai", KaiTi, STKaiti, serif',
  pingfang: '"Moyu PingFang", "PingFang SC", "Microsoft YaHei", sans-serif',
  fengya: '"Moyu FZ FengYa", "FZ FengYa", "Songti SC", serif',
  tsukumin: '"Moyu FZ TsukuMin", "FZ TsukuMin", "Songti SC", serif',
  yousong: '"Moyu FZ YouSong", "FZ YouSong", "Songti SC", serif',
  lantinghei: '"Moyu FZ LanTingHei", "FZ LanTingHei", "Microsoft YaHei", sans-serif',
  youhei: '"Moyu FZ YouHei", "FZ YouHei", "Microsoft YaHei", sans-serif',
  tsukugothic: '"Moyu FZ TsukuGothic", "FZ TsukuGothic", "Microsoft YaHei", sans-serif',
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
    @font-face { font-family: "Moyu PingFang"; src: url("${EPUB_FONT_URLS.pingFangRegular}") format("truetype"); font-weight: 400; font-style: normal; }
    @font-face { font-family: "Moyu PingFang"; src: url("${EPUB_FONT_URLS.pingFangBold}") format("truetype"); font-weight: 700; font-style: normal; }
    @font-face { font-family: "Moyu FZ FengYa"; src: url("${EPUB_FONT_URLS.fengYaRegular}") format("truetype"); font-weight: 400; font-style: normal; }
    @font-face { font-family: "Moyu FZ FengYa"; src: url("${EPUB_FONT_URLS.fengYaDemiBold}") format("truetype"); font-weight: 600; font-style: normal; }
    @font-face { font-family: "Moyu FZ TsukuMin"; src: url("${EPUB_FONT_URLS.tsukuMinRegular}") format("truetype"); font-weight: 400; font-style: normal; }
    @font-face { font-family: "Moyu FZ TsukuMin"; src: url("${EPUB_FONT_URLS.tsukuMinBold}") format("truetype"); font-weight: 700; font-style: normal; }
    @font-face { font-family: "Moyu FZ YouSong"; src: url("${EPUB_FONT_URLS.youSongVariable}") format("truetype"); font-weight: 300 700; font-style: normal; }
    @font-face { font-family: "Moyu FZ LanTingHei"; src: url("${EPUB_FONT_URLS.lanTingHeiVariable}") format("truetype"); font-weight: 300 700; font-style: normal; }
    @font-face { font-family: "Moyu FZ YouHei"; src: url("${EPUB_FONT_URLS.youHeiVariable}") format("truetype"); font-weight: 300 700; font-style: normal; }
    @font-face { font-family: "Moyu FZ TsukuGothic"; src: url("${EPUB_FONT_URLS.tsukuGothicRegular}") format("truetype"); font-weight: 400; font-style: normal; }
    @font-face { font-family: "Moyu FZ TsukuGothic"; src: url("${EPUB_FONT_URLS.tsukuGothicBold}") format("truetype"); font-weight: 700; font-style: normal; }
  `
  document.head.appendChild(style)
}
