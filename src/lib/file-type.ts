/** 파일명 또는 MIME이 PDF라고 주장하는지 확인하는 보조 신호다. */
export function claimsPdf(file: File): boolean {
  return file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf"
}
