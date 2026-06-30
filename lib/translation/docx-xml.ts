export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function extractParagraphText(paragraphXml: string): string {
  const parts: string[] = [];

  for (const match of paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) {
    parts.push(match[1] ?? "");
  }

  return parts.join("");
}

export function setParagraphText(paragraphXml: string, newText: string): string {
  const escaped = escapeXmlText(newText);
  let replaced = false;

  const updated = paragraphXml.replace(
    /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g,
    (match, attributes = "", _text) => {
      if (!replaced) {
        replaced = true;
        return `<w:t${attributes}>${escaped}</w:t>`;
      }

      return `<w:t${attributes}></w:t>`;
    },
  );

  if (replaced) {
    return updated;
  }

  return paragraphXml.replace(
    /<\/w:p>\s*$/,
    `<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`,
  );
}

export function createTranslatedParagraphXml(text: string): string {
  return [
    "<w:p>",
    "<w:pPr><w:spacing w:before=\"120\" w:after=\"120\"/></w:pPr>",
    "<w:r>",
    "<w:rPr><w:i/></w:rPr>",
    `<w:t xml:space="preserve">${escapeXmlText(text)}</w:t>`,
    "</w:r>",
    "</w:p>",
  ].join("");
}

export function extractDocumentBody(documentXml: string): {
  prefix: string;
  body: string;
  suffix: string;
} {
  const match = /<w:body[^>]*>([\s\S]*?)<\/w:body>/i.exec(documentXml);

  if (!match || match.index === undefined) {
    throw new Error("Invalid Word document: missing document body.");
  }

  const bodyStart = match.index + match[0].indexOf(match[1]);
  const bodyEnd = bodyStart + match[1].length;

  return {
    prefix: documentXml.slice(0, bodyStart),
    body: match[1],
    suffix: documentXml.slice(bodyEnd),
  };
}
