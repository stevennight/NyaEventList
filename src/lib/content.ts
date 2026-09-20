/** 旧表里“具体内容”习惯写成「功能开发：xxx」，前缀就是工作内容划分本身；划分单独成列以后，去掉重复的前缀。 */
export function stripTypePrefix(content: string, workType: string | null | undefined): string {
  const text = content.trim();
  const type = workType?.trim();
  if (!type) return text;
  for (const sep of ["：", ":"]) {
    if (text.startsWith(type + sep)) return text.slice(type.length + 1).trim();
  }
  return text;
}
