// 旧笔记数据迁移：评论功能已并入收藏（备注即标题），删除历史上的 comment/color 字段。
// 返回 { notesMap, changed }；无变更时原样返回，避免触发不必要的写盘。
export function stripLegacyNoteFields(notesMap) {
  if (!notesMap || typeof notesMap !== 'object') return { notesMap, changed: false }
  let changed = false
  const next = {}
  for (const [bookId, notes] of Object.entries(notesMap)) {
    next[bookId] = (Array.isArray(notes) ? notes : []).map((note) => {
      if (!note || typeof note !== 'object') return note
      if (!('comment' in note) && !('color' in note)) return note
      changed = true
      const { comment, color, ...rest } = note
      return rest
    })
  }
  return { notesMap: changed ? next : notesMap, changed }
}
