import t2cn from 'opencc-js/t2cn'
import cn2t from 'opencc-js/cn2t'

const simplified = t2cn.Converter({ from: 'tw', to: 'cn' })
const traditional = cn2t.Converter({ from: 'cn', to: 'tw' })

if (simplified('漢字與閱讀') !== '汉字与阅读') throw new Error('繁体转简体失败')
if (traditional('汉字与阅读') !== '漢字與閱讀') throw new Error('简体转繁体失败')
console.log('PASS [OpenCC] 繁简双向词组转换')
