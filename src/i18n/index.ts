/**
 * 다국어(i18n) 지원
 * ------------------------------------------------------------
 * 화면에 나오는 모든 글자는 ko.ts / en.ts 사전에서 꺼내 씁니다.
 *  - 컴포넌트 안:   const t = useT();  t('menu.file')
 *  - 컴포넌트 밖:   tr('menu.file')
 * 문장 안의 {name} 같은 부분은 params 로 바꿔 넣을 수 있습니다.
 *    t('toast.saved', { name: 'hero.pxe' })
 */
import { useCallback } from 'react';
import { useEditor, type Lang } from '../store/editorStore';
import { en } from './en';
import { ko, type TKey } from './ko';

export type { TKey };

const dictionaries: Record<Lang, Record<TKey, string>> = { ko, en };

export function translate(lang: Lang, key: TKey, params?: Record<string, string | number>): string {
  let text = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

/** React 컴포넌트에서 사용하는 번역 함수 훅 */
export function useT(): (key: TKey, params?: Record<string, string | number>) => string {
  const lang = useEditor((s) => s.language);
  return useCallback((key: TKey, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);
}

/** 컴포넌트 밖(액션, 도구 등)에서 사용하는 번역 함수 */
export function tr(key: TKey, params?: Record<string, string | number>): string {
  return translate(useEditor.getState().language, key, params);
}
