import { evalRule } from '@shared/conditions';
import type { Campaign, FormField } from '@shared/schema';
import { renderUrl, toStr, type Ctx } from '@shared/template';
import type { AppContext } from '../context';
import { HttpError } from '../lib/errors';
import { newId } from '../lib/ids';
import { recordEvent } from './events';
import { getProspect, type Prospect } from './prospects';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface SubmissionResult {
  ok: true;
  redirect?: string;
}

/**
 * Validates a submission against the form block that rendered it. Only fields the block declares
 * are accepted, so nobody can stuff arbitrary data into the submission record.
 */
export function handleSubmission(
  app: AppContext,
  campaign: Campaign,
  prospect: Prospect | null,
  ctx: Ctx,
  raw: Record<string, unknown>,
  meta: { ip: string; ua: string; isBot: boolean },
): SubmissionResult {
  // honeypot: real people never see this field. Pretend success so bots learn nothing.
  if (toStr(raw._hp)) return { ok: true };

  const form = campaign.page.blocks.find(
    (b): b is Extract<typeof b, { type: 'form' }> =>
      b.type === 'form' && !b.hidden && (raw._block ? b.id === raw._block : true) && evalRule(b.rule, ctx),
  );
  if (!form) throw new HttpError(400, 'bad_request', 'This form is no longer available.');

  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const f of form.fields as FormField[]) {
    let v = toStr(raw[f.key]).slice(0, 2000);
    if (f.type === 'checkbox') v = v ? 'yes' : '';
    if (f.type === 'textarea')
      v = String(raw[f.key] ?? '')
        .replace(/\r\n?/g, '\n')
        .trim()
        .slice(0, 4000);
    if (!v && f.required) errors[f.key] = `${f.label} is required`;
    else if (v && f.type === 'email' && !EMAIL_RE.test(v)) errors[f.key] = 'Enter a valid email address';
    else if (v && f.type === 'select' && f.options?.length && !f.options.includes(v)) errors[f.key] = 'Choose one of the options';
    if (v) values[f.key] = v;
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'validation_error', Object.values(errors)[0], { fields: errors });

  app.db.run(
    'INSERT INTO submissions (id, campaign_id, prospect_id, data, created_at) VALUES (?, ?, ?, ?, ?)',
    newId('sub'),
    campaign.id,
    prospect?.id ?? null,
    JSON.stringify(values),
    Date.now(),
  );

  // If the prospect had no email and the form collected one, remember it.
  if (prospect && !prospect.email && values.email) {
    try {
      app.db.run(
        'UPDATE prospects SET email = ?, updated_at = ? WHERE id = ? AND email IS NULL',
        values.email.toLowerCase(),
        Date.now(),
        prospect.id,
      );
    } catch {
      /* unique clash with another prospect: leave as is */
    }
  }

  recordEvent(app, {
    campaignId: campaign.id,
    prospectId: prospect?.id ?? null,
    type: 'submit',
    props: { block: form.id, fields: values },
    isBot: meta.isBot,
    ip: meta.ip,
    ua: meta.ua,
  });

  const redirect = form.redirect_url ? renderUrl(form.redirect_url, ctx) : '';
  return redirect ? { ok: true, redirect } : { ok: true };
}

export const reloadProspect = (app: AppContext, id: string) => getProspect(app, id);
