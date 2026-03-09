/**
 * Text extraction utilities for different file types.
 * Used by the translate panel to get translatable text from files.
 */

export async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = content.items.map((item: any) => item.str).join(" ");
    if (text.trim()) pages.push(text);
  }
  return pages.join("\n\n");
}

export async function extractTextFromDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  return result.value;
}

export function extractTextFromPlainFile(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}
