export function quickDefaults(kind, instruction = '', fileNames = []) {
  const labels = { lookup: '查依据', review: '审材料', draft: '写材料' };
  const title = fileNames[0]?.replace(/\.[^.]+$/, '') || instruction.trim().split(/[\n。！？]/)[0] || labels[kind];
  return {
    name: `${labels[kind]} · ${title}`.slice(0, 100),
    goal: instruction.trim() || '检查材料中的逻辑、信息完整性、文字和数据问题',
    deliverable: kind === 'review' ? '审查意见' : kind === 'draft' ? '工作稿' : '问题答复',
  };
}

export function quickFileRole(name, index) {
  if (/\.(xlsx?|xlsm|csv)$/i.test(name)) return 'data';
  return index === 0 ? 'main' : 'attachment';
}

export function quickInputError(kind, instruction, fileCount, sourceCount = 0) {
  if (kind === 'review' && !fileCount) return '放入要审查的文件，就可以开始。';
  if (kind !== 'review' && !instruction.trim()) return kind === 'draft' ? '说一下要写什么，例如用途、内容和篇幅。' : '输入要找的制度名称或问题。';
  if (fileCount + sourceCount > 12) return '一次最多使用12份材料，请分批处理。';
  return '';
}
