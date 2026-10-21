import { Image as ImageIcon, Link2, QrCode, Type, type LucideIcon } from 'lucide-react';
import { newBlockId } from '@shared/blocks';
import type { PdfField } from '@shared/schema';
import type { Rect } from './geometry';

export type FieldType = PdfField['type'];
export type TextField = Extract<PdfField, { type: 'text' }>;
export type Tool = 'select' | FieldType;

export const FIELD_META: Record<
  FieldType,
  { label: string; plural: string; icon: LucideIcon; hint: string; size: { w: number; h: number } }
> = {
  text: {
    label: 'Text',
    plural: 'text',
    icon: Type,
    hint: 'Write merge fields like {{first_name}} onto the page',
    size: { w: 190, h: 24 },
  },
  image: { label: 'Image', plural: 'images', icon: ImageIcon, hint: 'Place a prospect’s logo or any picture', size: { w: 120, h: 64 } },
  qr: { label: 'QR code', plural: 'QR codes', icon: QrCode, hint: 'A QR code that opens their personal page', size: { w: 72, h: 72 } },
  link: { label: 'Link', plural: 'links', icon: Link2, hint: 'Make an area of the PDF clickable', size: { w: 150, h: 28 } },
};

export function makeField(type: FieldType, page: number, rect: Rect): PdfField {
  const base = { id: `f_${newBlockId()}`, page, rect };
  switch (type) {
    case 'text':
      return {
        ...base,
        type,
        text: '{{first_name|there}}',
        font: { family: 'inter', bold: false, italic: false },
        size: 14,
        color: '#111827',
        align: 'left',
        valign: 'top',
        fit: 'shrink',
        line_height: 1.25,
        mask: null,
      };
    case 'image':
      return { ...base, type, src: '{{logo_url}}', fit: 'contain', mask: null };
    case 'qr':
      return { ...base, type, url: '{{page_url}}', color: '#000000', background: '#ffffff' };
    case 'link':
      return { ...base, type, url: '{{page_url}}' };
  }
}

/** Short human title for a field in lists and on the canvas. */
export function fieldTitle(f: PdfField): string {
  if (f.label) return f.label;
  if (f.type === 'text') return f.text.replace(/\s+/g, ' ').trim() || 'Empty text';
  if (f.type === 'image') return /\{\{/.test(f.src) ? f.src.replace(/\{\{\s*|\s*\}\}/g, '') : 'Picture';
  if (f.type === 'qr') return 'QR code';
  return f.url || 'Link';
}

/**
 * Guess the merge field for text that is obviously a placeholder ("[Company]", "Your Name"…), so
 * one click does the right thing most of the time. Returns undefined when there is no clear guess.
 */
export function suggestTemplate(text: string): string | undefined {
  const t = text
    .trim()
    .replace(/^[\[\(<{]+|[\]\)>}]+$/g, '')
    .trim()
    .toLowerCase();
  if (!t || t.length > 40) return undefined;
  if (/^(your |their |prospect'?s? |client'?s? |customer'?s? )?first name$/.test(t)) return '{{first_name|there}}';
  if (/^(your |their |prospect'?s? |client'?s? |customer'?s? )?last name$/.test(t) || t === 'surname') return '{{last_name}}';
  if (
    /^(your |their |prospect'?s? |client'?s? |customer'?s? |recipient'?s? |contact )?(full )?name$/.test(t) ||
    /^(prospect|client|customer|recipient|contact)( name)?$/.test(t)
  )
    return '{{full_name|you}}';
  if (
    /^(your |their |prospect'?s? |client'?s? |customer'?s? )?(company|organi[sz]ation|business|account)( name)?$/.test(t) ||
    /^(company|client) (name|logo)$/.test(t)
  )
    return '{{company|your company}}';
  if (/^(your |their )?(job )?(title|role|position)$/.test(t)) return '{{job_title|your role}}';
  if (/^(today'?s? )?date$/.test(t)) return '{{today}}';
  return undefined;
}
