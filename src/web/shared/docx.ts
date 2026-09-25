/* Minimal .docx writer: just enough OOXML (Content_Types, root rels,
   word/document.xml) for Word, LibreOffice and Google Docs to open it.
   No numbering part: bullets are a literal "- " marker, which also
   keeps this file free of anything that could pass for an em dash. */
import { buildZip } from './zip.js';
import type { CvBlock } from './cv-template.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paragraph(pProps: string, rProps: string, text: string): string {
  return `<w:p>${pProps}<w:r>${rProps}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function blockXml(b: CvBlock): string {
  switch (b.type) {
    case 'title':
      return paragraph('<w:pPr><w:spacing w:after="60"/></w:pPr>', '<w:rPr><w:b/><w:sz w:val="44"/></w:rPr>', b.text);
    case 'subtitle':
      return paragraph('<w:pPr><w:spacing w:before="160" w:after="20"/></w:pPr>', '<w:rPr><w:b/><w:sz w:val="24"/></w:rPr>', b.text);
    case 'meta':
      return paragraph('<w:pPr><w:spacing w:after="80"/></w:pPr>', '<w:rPr><w:color w:val="595959"/><w:sz w:val="20"/></w:rPr>', b.text);
    case 'heading':
      return paragraph(
        '<w:pPr><w:spacing w:before="240" w:after="100"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="999999"/></w:pBdr></w:pPr>',
        '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr>', b.text);
    case 'bullet':
      return paragraph('<w:pPr><w:ind w:left="360"/><w:spacing w:after="60"/></w:pPr>', '<w:rPr><w:sz w:val="21"/></w:rPr>', `- ${b.text}`);
    case 'para':
      return paragraph('<w:pPr><w:spacing w:after="60"/></w:pPr>', '<w:rPr><w:sz w:val="21"/></w:rPr>', b.text);
    case 'space':
      return '<w:p/>';
  }
}

export function buildCvDocx(blocks: CvBlock[]): Blob {
  const body = blocks.map(blockXml).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const enc = new TextEncoder();
  const zip = buildZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'word/document.xml', data: enc.encode(documentXml) },
  ]);
  return new Blob([zip as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
