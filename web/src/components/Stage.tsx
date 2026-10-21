import type { Engagement } from '../types';

export const STAGE_LABEL: Record<Engagement['stage'], string> = {
  new: 'Not opened',
  opened: 'Opened',
  engaged: 'Engaged',
  converted: 'Converted',
};

export function StageChip({ stage }: { stage: Engagement['stage'] }) {
  return (
    <span className={`stage ${stage}`}>
      <i />
      {STAGE_LABEL[stage]}
    </span>
  );
}
