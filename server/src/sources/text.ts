/** HTML/엔티티를 걷어내 요약 입력용 평문으로. 비거나 없으면 undefined. */
export function extractText(
  raw: string | undefined | null,
  maxLen = 1500, // 요약 프롬프트에 싣는 본문 상한(단일 절단 지점)
): string | undefined {
  if (!raw) return undefined;
  // 코드포인트가 유효 범위(≤0x10FFFF)를 벗어나면 fromCodePoint 가 throw 한다 —
  // 범위 밖이면 공백으로 흘려보내 소스 전체가 죽는 걸 막는다.
  const decode = (n: number) => (n <= 0x10ffff ? String.fromCodePoint(n) : ' ');
  const text = raw
    .replace(/<[^>]+>/g, ' ') // 태그 제거
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => decode(parseInt(h, 16))) // 16진수 엔티티
    .replace(/&#(\d+);/g, (_, d) => decode(parseInt(d, 10))) // 10진수 엔티티
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;/gi, ' ') // 나머지 명명 엔티티는 공백
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}
