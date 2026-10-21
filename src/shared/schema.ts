import { z } from 'zod';

/**
 * The shared data contract. Everything a campaign is made of lives here so the server
 * (validation, rendering) and the dashboard (editing) can never drift apart.
 *
 * Rules of thumb:
 *  - Anything interpolated into CSS is validated against a strict pattern.
 *  - Free text may contain {{merge tokens}}; it is escaped at render time, never here.
 *  - Every list and string has an upper bound so a request can't ask us to store a novel.
 */

const text = (max: number) => z.string().max(max);
/** Ids end up in HTML attributes and in tracked-link paths (`<block>.<slot>`), so keep them plain. */
const ident = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, dashes and underscores');
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour like #4f46e5');

// ── Rules ("only show this when …") ─────────────────────────────────────────

export const CONDITION_OPS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'matches',
  'exists',
  'not_exists',
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const ConditionSchema = z.object({
  field: text(80).min(1),
  op: z.enum(CONDITION_OPS),
  value: text(500).default(''),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const RuleSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(ConditionSchema).max(10).default([]),
});
export type Rule = z.infer<typeof RuleSchema>;

// ── Buttons & images ────────────────────────────────────────────────────────

export const ActionSchema = z.discriminatedUnion('type', [
  /** Opens a URL (tokens allowed, e.g. a Calendly link prefilled with {{email}}). Click is tracked. */
  z.object({ type: z.literal('link'), url: text(2000).default('') }),
  /** Scrolls to the first form on the page. */
  z.object({ type: z.literal('form') }),
  /** Downloads this prospect's personalised PDF. */
  z.object({ type: z.literal('document') }),
  /** Scrolls to a block by its anchor name. */
  z.object({ type: z.literal('anchor'), anchor: text(60).default('') }),
]);
export type Action = z.infer<typeof ActionSchema>;

export const ButtonSchema = z.object({
  label: text(80).default('Learn more'),
  action: ActionSchema.default({ type: 'form' }),
});
export type Button = z.infer<typeof ButtonSchema>;

/** `src` is an asset id (ast_…), an https URL, or a token such as {{logo_url}}. */
export const ImageSchema = z.object({
  src: text(2000).default(''),
  alt: text(200).default(''),
});
export type ImageRef = z.infer<typeof ImageSchema>;

// ── Blocks ──────────────────────────────────────────────────────────────────

const blockBase = {
  id: ident,
  /** Name used by "scroll to" buttons and #links. */
  anchor: text(60).optional(),
  hidden: z.boolean().optional(),
  /** Persona targeting: the block only renders for prospects matching this rule. */
  rule: RuleSchema.optional(),
  bg: z.enum(['default', 'alt', 'brand', 'dark']).optional(),
  pad: z.enum(['sm', 'md', 'lg']).optional(),
  align: z.enum(['left', 'center']).optional(),
};

export const ICON_NAMES = [
  'check',
  'zap',
  'target',
  'users',
  'clock',
  'shield',
  'star',
  'rocket',
  'chart',
  'trending-up',
  'mail',
  'phone',
  'globe',
  'lock',
  'sparkles',
  'calendar',
  'file-text',
  'heart',
  'lightbulb',
  'layers',
  'handshake',
  'search',
  'settings',
  'puzzle',
  'award',
  'banknote',
  'briefcase',
  'compass',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export const FormFieldSchema = z.object({
  key: text(40).regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and underscores'),
  label: text(120),
  type: z.enum(['text', 'email', 'tel', 'textarea', 'select', 'checkbox']).default('text'),
  required: z.boolean().default(false),
  placeholder: text(120).optional(),
  options: z.array(text(80)).max(20).optional(),
  /** Template used to prefill the field for this prospect, e.g. {{email}}. */
  prefill: text(200).optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const HeroBlock = z.object({
  ...blockBase,
  type: z.literal('hero'),
  eyebrow: text(120).optional(),
  /** Small pill, usually the personal line: "Prepared for {{first_name}} at {{company}}". */
  badge: text(160).optional(),
  headline: text(240).default(''),
  subheadline: text(700).optional(),
  primary: ButtonSchema.optional(),
  secondary: ButtonSchema.optional(),
  image: ImageSchema.optional(),
  /** Use the prospect's personalised PDF cover as the hero image. */
  show_document: z.boolean().optional(),
  layout: z.enum(['split', 'centered']).default('split'),
});

export const TextBlock = z.object({
  ...blockBase,
  type: z.literal('text'),
  heading: text(240).optional(),
  body: text(6000).default(''),
});

export const FeaturesBlock = z.object({
  ...blockBase,
  type: z.literal('features'),
  heading: text(240).optional(),
  intro: text(600).optional(),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
  items: z
    .array(z.object({ icon: text(30).optional(), title: text(160).default(''), text: text(600).default('') }))
    .max(12)
    .default([]),
});

export const ChecklistBlock = z.object({
  ...blockBase,
  type: z.literal('checklist'),
  heading: text(240).optional(),
  intro: text(600).optional(),
  style: z.enum(['check', 'bullet', 'number']).default('check'),
  items: z.array(text(400)).max(20).default([]),
});

export const StatsBlock = z.object({
  ...blockBase,
  type: z.literal('stats'),
  heading: text(240).optional(),
  items: z
    .array(z.object({ value: text(24).default(''), label: text(160).default('') }))
    .max(6)
    .default([]),
});

export const StepsBlock = z.object({
  ...blockBase,
  type: z.literal('steps'),
  heading: text(240).optional(),
  intro: text(600).optional(),
  items: z
    .array(z.object({ title: text(160).default(''), text: text(500).optional() }))
    .max(8)
    .default([]),
});

export const TestimonialBlock = z.object({
  ...blockBase,
  type: z.literal('testimonial'),
  quote: text(800).default(''),
  name: text(120).optional(),
  role: text(120).optional(),
  company: text(120).optional(),
  avatar: ImageSchema.optional(),
  logo: ImageSchema.optional(),
});

export const LogosBlock = z.object({
  ...blockBase,
  type: z.literal('logos'),
  heading: text(240).optional(),
  grayscale: z.boolean().default(true),
  items: z.array(ImageSchema).max(12).default([]),
});

export const ImageBlock = z.object({
  ...blockBase,
  type: z.literal('image'),
  image: ImageSchema.default({ src: '', alt: '' }),
  caption: text(300).optional(),
  width: z.enum(['content', 'wide', 'full']).default('content'),
});

export const VideoBlock = z.object({
  ...blockBase,
  type: z.literal('video'),
  heading: text(240).optional(),
  /** YouTube, Vimeo, Loom or Wistia URL. Tokens allowed so every prospect can get their own video. */
  url: text(2000).default(''),
  caption: text(300).optional(),
});

export const CtaBlock = z.object({
  ...blockBase,
  type: z.literal('cta'),
  heading: text(240).default(''),
  text: text(600).optional(),
  button: ButtonSchema.default({ label: 'Book a call', action: { type: 'form' } }),
  secondary: ButtonSchema.optional(),
});

export const FormBlock = z.object({
  ...blockBase,
  type: z.literal('form'),
  heading: text(240).optional(),
  intro: text(600).optional(),
  fields: z.array(FormFieldSchema).min(1).max(10),
  button_label: text(80).default('Send'),
  success_message: text(400).default('Thanks — we’ll be in touch shortly.'),
  /** Optional URL to send people to after submitting (tokens allowed). */
  redirect_url: text(2000).optional(),
});

export const FaqBlock = z.object({
  ...blockBase,
  type: z.literal('faq'),
  heading: text(240).optional(),
  items: z
    .array(z.object({ q: text(300).default(''), a: text(2000).default('') }))
    .max(15)
    .default([]),
});

export const CalendarBlock = z.object({
  ...blockBase,
  type: z.literal('calendar'),
  heading: text(240).optional(),
  intro: text(600).optional(),
  /** Calendly, Cal.com or HubSpot meetings link. Name/email are prefilled when known. */
  url: text(2000).default(''),
  height: z.number().int().min(360).max(1200).default(700),
});

export const NoteBlock = z.object({
  ...blockBase,
  type: z.literal('note'),
  from_name: text(120).default(''),
  from_role: text(160).optional(),
  avatar: ImageSchema.optional(),
  message: text(3000).default(''),
});

export const DocumentBlock = z.object({
  ...blockBase,
  type: z.literal('document'),
  heading: text(240).optional(),
  text: text(600).optional(),
  button_label: text(80).default('Download your copy'),
  show_preview: z.boolean().default(true),
});

export const HtmlBlock = z.object({
  ...blockBase,
  type: z.literal('html'),
  /** Sanitised on render: no scripts or event handlers; iframes only from approved hosts. */
  html: text(20000).default(''),
});

export const DividerBlock = z.object({
  ...blockBase,
  type: z.literal('divider'),
});

export const BlockSchema = z.discriminatedUnion('type', [
  HeroBlock,
  TextBlock,
  FeaturesBlock,
  ChecklistBlock,
  StatsBlock,
  StepsBlock,
  TestimonialBlock,
  LogosBlock,
  ImageBlock,
  VideoBlock,
  CtaBlock,
  FormBlock,
  FaqBlock,
  CalendarBlock,
  NoteBlock,
  DocumentBlock,
  HtmlBlock,
  DividerBlock,
]);
export type Block = z.infer<typeof BlockSchema>;
export type BlockType = Block['type'];
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

// ── Page ────────────────────────────────────────────────────────────────────

export const FONT_CHOICES = ['inter', 'system', 'serif', 'mono'] as const;

export const ThemeSchema = z.object({
  brand: hex.default('#4f46e5'),
  accent: hex.optional(),
  bg: hex.default('#ffffff'),
  alt_bg: hex.default('#f5f6fa'),
  dark_bg: hex.default('#0f1224'),
  text: hex.default('#0f172a'),
  muted: hex.default('#475569'),
  font: z.enum(FONT_CHOICES).default('inter'),
  heading_font: z.enum(FONT_CHOICES).optional(),
  radius: z.enum(['sharp', 'soft', 'round']).default('soft'),
  width: z.enum(['narrow', 'normal', 'wide']).default('normal'),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const PageSchema = z.object({
  theme: ThemeSchema.prefault({}),
  seo: z
    .object({
      title: text(160).default(''),
      description: text(320).default(''),
      og_image: ImageSchema.optional(),
      /** Personalised pages hold personal data, so they are hidden from search engines by default. */
      noindex: z.boolean().default(true),
      lang: text(8).default('en'),
    })
    .prefault({}),
  header: z
    .object({
      enabled: z.boolean().default(true),
      logo: ImageSchema.optional(),
      logo_text: text(60).optional(),
      button: ButtonSchema.optional(),
      sticky: z.boolean().default(false),
    })
    .prefault({}),
  footer: z
    .object({
      text: text(600).default(''),
      links: z
        .array(z.object({ label: text(60), url: text(2000) }))
        .max(8)
        .default([]),
    })
    .prefault({}),
  blocks: z.array(BlockSchema).max(80).default([]),
  /** Author-supplied CSS appended after the theme. */
  custom_css: text(20000).optional(),
});
export type Page = z.infer<typeof PageSchema>;

// ── PDF personalisation ─────────────────────────────────────────────────────

export const RectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(0),
  h: z.number().finite().min(0),
});
/** A box on a PDF page, in PDF points with the origin at the TOP-left. */
export type Rect = z.infer<typeof RectSchema>;

const fieldBase = {
  id: ident,
  /** 1-based page number. */
  page: z.number().int().min(1).max(500),
  rect: RectSchema,
  rule: RuleSchema.optional(),
  label: text(120).optional(),
};

export const PdfFontSchema = z.object({
  /** `auto` means "match the original text"; it is resolved when the field is created. */
  family: z.enum(['auto', 'inter', 'helvetica', 'serif', 'mono']).default('auto'),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
});

/** Paints over the original content first. `rect` defaults to the field's own box. */
export const MaskSchema = z.object({
  color: hex,
  pad: z.number().min(0).max(20).default(1),
  rect: RectSchema.optional(),
});

export const PdfTextField = z.object({
  ...fieldBase,
  type: z.literal('text'),
  text: text(1500).default(''),
  font: PdfFontSchema.prefault({}),
  size: z.number().min(4).max(200).default(12),
  color: hex.default('#000000'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  valign: z.enum(['top', 'middle', 'bottom']).default('top'),
  /** shrink = scale down to fit on one line, wrap = wrap inside the box, none = draw as-is. */
  fit: z.enum(['shrink', 'wrap', 'none']).default('shrink'),
  line_height: z.number().min(0.8).max(3).default(1.25),
  /** Paint over whatever is under the box first (used when replacing existing text). */
  mask: MaskSchema.nullable().default(null),
  /** The original PDF text this field replaces (display only). */
  source_text: text(500).optional(),
});

export const PdfImageField = z.object({
  ...fieldBase,
  type: z.literal('image'),
  /** Asset id, https URL or token such as {{logo_url}}. Skipped when it resolves to nothing. */
  src: text(2000).default(''),
  fit: z.enum(['contain', 'cover']).default('contain'),
  mask: MaskSchema.nullable().default(null),
});

export const PdfQrField = z.object({
  ...fieldBase,
  type: z.literal('qr'),
  url: text(2000).default('{{page_url}}'),
  color: hex.default('#000000'),
  background: hex.nullable().default('#ffffff'),
});

export const PdfLinkField = z.object({
  ...fieldBase,
  type: z.literal('link'),
  url: text(2000).default('{{page_url}}'),
});

export const PdfFieldSchema = z.discriminatedUnion('type', [PdfTextField, PdfImageField, PdfQrField, PdfLinkField]);
export type PdfField = z.infer<typeof PdfFieldSchema>;
export type PdfTextFieldT = z.infer<typeof PdfTextField>;

export const DocumentSchema = z.object({
  asset_id: text(40),
  page_count: z.number().int().min(1).max(500).default(1),
  /** Download file name; may contain tokens. */
  filename: text(200).default('{{company|Document}}.pdf'),
  fields: z.array(PdfFieldSchema).max(400).default([]),
});
export type DocumentConfig = z.infer<typeof DocumentSchema>;

// ── Campaign settings ───────────────────────────────────────────────────────

export const AiFieldSchema = z.object({
  /** Becomes the merge token {{ai_<key>}}. */
  key: text(40).regex(/^[a-z][a-z0-9_]*$/),
  label: text(80).default(''),
  prompt: text(1500).default(''),
  max_chars: z.number().int().min(20).max(1000).default(220),
  /** Used when AI is unavailable or fails. */
  fallback: text(1000).default(''),
});
export type AiField = z.infer<typeof AiFieldSchema>;

export const CampaignSettingsSchema = z.object({
  /** Prospect fields that must be present, otherwise the API answers 422 and no link is issued. */
  required_fields: z.array(text(60)).max(20).default([]),
  /** Let /c/<slug>?first_name=… personalise the page without a stored prospect. */
  allow_url_params: z.boolean().default(false),
  /** Domain used when building links for this campaign (must be an allowed domain). */
  domain: text(253).optional(),
  ai_fields: z.array(AiFieldSchema).max(8).default([]),
  /** Tidy ALL-CAPS / lowercase names coming from enrichment. */
  clean_names: z.boolean().default(true),
});
export type CampaignSettings = z.infer<typeof CampaignSettingsSchema>;

// ── Campaign (as exchanged with the dashboard) ──────────────────────────────

export const CAMPAIGN_STATUSES = ['draft', 'live', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface CampaignSource {
  type: 'scratch' | 'pdf';
  asset_id?: string;
  filename?: string;
  imported_at?: number;
  /** Human-readable notes from the importer ("12 headings found", "AI used", …). */
  report?: string[];
}

export interface Campaign {
  id: string;
  name: string;
  slug: string;
  status: CampaignStatus;
  page: Page;
  document: DocumentConfig | null;
  settings: CampaignSettings;
  source: CampaignSource | null;
  version: number;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

export const CampaignUpdateSchema = z.object({
  name: text(120).min(1).optional(),
  slug: text(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and dashes')
    .optional(),
  page: PageSchema.optional(),
  document: DocumentSchema.nullable().optional(),
  settings: CampaignSettingsSchema.optional(),
  /** Optimistic concurrency: the version the editor started from. */
  base_version: z.number().int().optional(),
});
export type CampaignUpdate = z.infer<typeof CampaignUpdateSchema>;
