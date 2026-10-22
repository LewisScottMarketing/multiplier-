import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Brand, BrandKit } from '../types';

export const useBrands = () =>
  useQuery({ queryKey: ['brands'], queryFn: () => api.get<{ brands: Brand[] }>('/brands'), staleTime: 30_000 });

/** The editable part of a saved brand. */
export const kitOf = ({ id: _id, is_default: _d, created_at: _c, updated_at: _u, ...kit }: Brand): BrandKit => kit;

export const blankKit = (): BrandKit => ({
  name: 'My brand',
  brand: '#4f46e5',
  font_names: '',
  voice: '',
  use: [],
  avoid: [],
  rules: '',
  source: { type: 'manual', notes: [] },
});
