import type { Category } from '../domain/types';
import { vi, type I18nDict } from './vi';
import { en } from './en';

export type { I18nDict };
export type Language = 'vi' | 'en';

export function getDict(lang: Language): I18nDict {
  return lang === 'en' ? en : vi;
}

export function getCategoryLabel(dict: I18nDict, cat: Category): string {
  switch (cat) {
    case 'reference':
      return dict.cat_reference;
    case 'furniture':
      return dict.cat_furniture;
    case 'palette':
      return dict.cat_palette;
    case 'material':
      return dict.cat_material;
    case 'sketch':
      return dict.cat_sketch;
    default:
      return dict.cat_other;
  }
}
