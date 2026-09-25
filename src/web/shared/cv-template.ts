/* The revamped CV, as a template: a small set of block types that a
   plain-text preview, a PDF and a DOCX can all render from the same
   source instead of each re-deriving layout from the flat text string. */

export type CvBlock =
  | { type: 'title'; text: string }
  | { type: 'subtitle'; text: string }
  | { type: 'meta'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'para'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'space' };

export interface CvTemplateFields {
  positioning: string; location: string; phone: string; email: string;
  roles: Array<{ company: string; title: string; start: string; end: string; bullets: string[] }>;
  skills: Array<{ group: string; items: string[] }>;
  education: string[];
}

export function cvBlocks(name: string, f: CvTemplateFields): CvBlock[] {
  const blocks: CvBlock[] = [{ type: 'title', text: name }];
  if (f.positioning) blocks.push({ type: 'subtitle', text: f.positioning });
  const contact = [f.location, f.phone, f.email].filter(Boolean).join('   |   ');
  if (contact) blocks.push({ type: 'meta', text: contact });
  blocks.push({ type: 'space' });

  if (f.roles.length) {
    blocks.push({ type: 'heading', text: 'Experience' });
    for (const role of f.roles) {
      blocks.push({ type: 'subtitle', text: `${role.title}, ${role.company}` });
      blocks.push({ type: 'meta', text: `${role.start} - ${role.end}` });
      for (const b of role.bullets) blocks.push({ type: 'bullet', text: b });
      blocks.push({ type: 'space' });
    }
  }
  if (f.skills.length) {
    blocks.push({ type: 'heading', text: 'Skills' });
    for (const g of f.skills) blocks.push({ type: 'para', text: `${g.group}: ${g.items.join(', ')}` });
    blocks.push({ type: 'space' });
  }
  if (f.education.length) {
    blocks.push({ type: 'heading', text: 'Education' });
    for (const e of f.education) blocks.push({ type: 'para', text: e });
  }
  return blocks;
}
