const details = {
  diff: ['MULTI-DOCUMENT DIFF','比较“意味着什么变了”，而不只是“哪些字变了”。','先对齐对象、时期、版本和范围，再比较事实、数字、规则、责任、公式与语义。删除文字、现行文字和批注分开处理，避免把修订痕迹制造成假冲突。',['多版本与跨文件口径对齐','文表、公式与附件联动核验','相同问题跨文件聚合']],
  review: ['EVIDENCE-LINKED REVIEW','审查的是证据能够支持什么，而不是模型能够联想到什么。','精确核验与语义检查并行；每个问题保留原文位置、判断依据、影响和结论类型。报告缺口前，先搜索后文、表格和附件中的反证。',['事实、缺口、冲突、推断分层','执行闭环逐环检查','材料不足明确标记无法核验']],
  improve: ['TRACEABLE IMPROVEMENT','修改建议可以有深度，但不能替材料补事实。','先锁定数字、术语、责任主体、判断基础与现有结论，再从准确性、完整性、可执行性、结构、表达和格式等维度优化。',['原文与建议逐项对应','关键改动保留理由','未知信息保留待补']],
  style: ['ADOPTED STYLE MEMORY','真正值得学习的，不是模型写过什么，而是用户选择了什么。','只有明确采用的终稿或指定样本进入文风库。系统学习文种结构、段落功能和表达偏好，但隔离名称、金额、日期与个案事实。',['单份样本只形成暂定偏好','保留来源与适用文种','事实证据与表达样本隔离']],
  knowledge: ['KNOWLEDGE STATUS','可检索，不等于可作为当前依据。','制度时效、正式程度、材料角色、组织范围和解析质量分别记录。现行与废止必须回到发布、生效、废止条款或权威台账核实。',['草稿与正式版分开','历史版本与现行候选分开','OCR、表格与修订盲区保留']]
};

const panel = document.querySelector('#capability-detail');
document.querySelectorAll('.capability').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.capability').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    const [kicker,title,copy,items] = details[button.dataset.capability];
    panel.innerHTML = `<p class="detail-kicker">${kicker}</p><h3>${title}</h3><p>${copy}</p><ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
  });
});
