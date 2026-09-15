export function sentenceReviewPromptBlock() {
  return `逐句精审采用以下固定流程：
1. 先建立终版证据基线：确认本轮文件和版本，检查编号连续性、批注、修订痕迹、占位符和逐页版式；不得沿用旧版本结论。
2. 再按文件和原文顺序逐句阅读，不得只抽样或只搜索关键词。逐句检查重复文字、错漏字、标点、搭配、语序，以及职责主体、术语口径、指代、修饰关系、语义边界和句子负担。
3. 对疑似专业术语错误，只有存在本轮材料中的依据或可核验的权威依据时，才可定性为明确错误；找不到权威依据时只标“需确认”，不得断定正确写法。
4. 将结果严格分为“明确错误—需确认的歧义—表达优化”：
   - 明确错误：原文可以直接确认的错漏、重复、语法搭配、编号、占位或正式术语错误，findingType=issue，inferenceLevel=fact。
   - 需确认的歧义：职责主体、指代、范围、条件或术语关系存在多种合理理解，findingType=issue，inferenceLevel=confirmable_omission；说明歧义在哪里，不代替业务确认。
   - 表达优化：原文未必错误，但句子负担、阅读障碍或表达效率可以改善，findingType=improvement，severity=low；不得把纯风格偏好当成错误。
5. 每条结果必须填写 originalText（完整原句）、suggestedText（尽量少改动的建议改法）和 rewriteReason（为什么这样改）；证据必须精确定位到文件名、页码或页码提示、条款/段落以及原句。
6. 先查找后文、表格、附件和同文档其他位置的反证，再输出结论；同一原句的多个相关症状合并为一条，避免重复报错。`;
}

export function prepareSentenceReviewFinding(issue, verifiedEvidence = []) {
  if (issue?.module !== "sentence") return issue;
  const originalText = String(issue.originalText || verifiedEvidence[0]?.quote || "").trim();
  const suggestedText = String(issue.suggestedText || "").trim();
  const rewriteReason = String(issue.rewriteReason || "").trim();
  if (!originalText || !suggestedText || !rewriteReason) return null;
  const category = issue.findingType === "improvement"
    ? "表达优化"
    : issue.inferenceLevel === "fact" ? "明确错误" : "需确认的歧义";
  return { ...issue, category, originalText, suggestedText, rewriteReason };
}
