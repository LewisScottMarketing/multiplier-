import { useBrands } from '../lib/brands';
import { Field, Select } from '../ui';

/**
 * Which brand a page follows. "" is the default brand, "none" is no brand at all. Renders nothing until a brand has been set
 * up, so people who don't use brands never see it.
 */
export function BrandSelect({
  value,
  onChange,
  noneLabel,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  noneLabel: string;
  id?: string;
}) {
  const brands = useBrands().data?.brands ?? [];
  if (!brands.length) return null;
  const fallback = brands.find((b) => b.is_default) ?? brands[0]!;
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Default brand ({fallback.name})</option>
      {brands.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
      <option value="none">{noneLabel}</option>
    </Select>
  );
}

/** The select with its label, for forms. Renders nothing until a brand has been set up. */
export function BrandField({
  value,
  onChange,
  noneLabel,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  noneLabel: string;
  hint?: string;
}) {
  const any = (useBrands().data?.brands.length ?? 0) > 0;
  if (!any) return null;
  return (
    <Field label="Brand" hint={hint}>
      <BrandSelect value={value} onChange={onChange} noneLabel={noneLabel} />
    </Field>
  );
}
